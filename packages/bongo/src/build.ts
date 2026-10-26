import { realpathSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { dim, green } from 'kleur/colors';
import * as mime from 'mrmime';

import * as attrs from './utils/attrs';
import * as data from './utils/data';
import { draft } from './utils/draft';
import * as fs from './utils/fs';
import * as images from './utils/images';
import * as log from './utils/log';
import * as output from './utils/output';
import * as bundler from './utils/bundler';
import * as css from './utils/css';
import { load, loadModule, LoadError } from './utils/config';
import * as loaders from './utils/loaders';
import * as memo from './utils/memo';
import * as render from './utils/render';
import * as templates from './utils/templates';
import * as tags from './utils/tags';
import * as utils from './utils/index';
import { normalize, outdir } from './utils/argv';
import { SCRIPT } from './utils/http';

import type { Argv, Build, Config, Loader, Template } from 'bongo';
import type { Blocks } from 'tempura';

// Per sink, the last good build's files, to delete the ones that the next build does not make.
type Output = { files: Set<string>; dev: boolean };

// Per sink, the memo of the last good build, so the next one renders only what changed; `bongo build` also saves it to disk.
let MEMOS: Map<output.Sink, memo.Memo> = new Map();

// The `<bongo:alternate>` elements that one page names, and the source that its Markdown copy comes from.
type Named = { path: string; input: string; from: string; found: tags.Alternate[] };
let OUTPUT: Map<output.Sink, Output> = new Map();

// Local files outside content/ that the last build's data modules read.
let IMPORTS: string[] = [];

// The assets/ files that the last good build read outside the bundler.
let LOADS: string[] = [];

// `search.json.ts` writes `search.json`
const DATA_MODULE = /\.json\.[jt]s$/;

// The pages that `bongo build` writes at once.
const WRITES = 64;

// The content files that a build reads and loads at once.
const READS = 16;

// A content file that changed this close to a build may change again within the precision of its mtime, so the next build reads it.
const RACY = 2000;

// A build that renders fewer pages leaves too little garbage for a full GC to pay for its time.
const COLLECT = 1000;

// Section = the directory prefix of the page's rel path, using forward slashes.
// e.g. "blog/post.md" -> "blog", "index.md" -> "", "blog/2025/post.md" -> "blog/2025"
// Note: index.* stripping only applies to URL path, NOT section derivation.
function deriveSection(rel: string): string {
	// Normalize backslashes (Windows) to forward slashes before splitting.
	let normalized = rel.split(/[\\\/]+/g);
	// Drop the filename — everything before it is the section.
	let parts = normalized.slice(0, -1);
	return parts.join('/');
}

type CollectedPage = {
	output: string;   // absolute path to write
	html?: string;    // rendered HTML, may contain placeholders; unset once `bongo build` has written it
	path: string;
	params: Template.Params;
	from: string;     // what rendered it, for errors (eg, "content/index.md → layouts/html.hbs")
	rel?: string;     // the content file of a page
};

type ScanItem = {
	input: string;           // absolute source path
	rel: string;             // path relative to content/
	name: string;            // basename with ext
	kind: 'page' | 'output' | 'data';
	ext: string;             // final extension (post-loader chain) — 'hbs'|'html'|'htm'
	body?: string;           // frontmatter stripped, loaders run; `.hbs` still raw for walk-2 compile; unset for a page whose source the memo had, and once the page renders
	params: Template.Params;
	path: string;            // URL path (e.g. '/blog/post-1/')
	url: string;             // absolute URL, under the subfolder of `$site.url` if any
	output: string;          // absolute output path
	section: string;         // derived from rel's dirname
	title: string;
	summary: string;
	tags: string[];          // parsed from frontmatter.tags
	headings: Template.Heading[];
	hash: string;            // of the source file, to compare with the memo
	record?: string;         // a hash of its entry in the registries; from the memo for a page whose source it had
	draft?: boolean;         // `draft: true`, or a `date` after the build started, unless `draft: false`
};

// Frontmatter is typed, so `title: 2024` is a number; page text fields take any scalar as text.
function text(value: unknown): string {
	let type = typeof value;
	return type === 'string' || type === 'number' || type === 'boolean' ? String(value) : '';
}

const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function headings(list: Loader.Heading[] | undefined): Template.Heading[] {
	return (list || []).map(heading => ({
		level: heading.level,
		id: heading.id,
		text: heading.text,
		html: heading.html ?? heading.text.replace(/[&<>"]/g, char => HTML_ESCAPE[char]),
	}));
}

// An error from the templates of a page, with the files that rendered it.
async function rendering<T>(from: string, work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (err) {
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`${reason}, rendering ${from}`, { cause: err });
	}
}

// Module level, since the `$assets` of compiled partials keeps it until the next build.
const LOADER_UTILS: Loader.Utilities = {
	frontmatter: templates.frontmatter,
	attrs: attrs.parse,

	render(name, ...args) {
		let view = templates.Partials.get(name);
		// @ts-ignore - strict bind/apply rule
		if (view) return view.apply(view, args);
		throw new Error(`Unknown "${name}" partial!`);
	},

	decode(input) {
		return new TextDecoder().decode(input);
	},
};

// switcheroo: templates get a reader for assets/ in place of the loader map
// Compiled partials keep the template context until the next build, so this lives outside `run` and keeps none of the build (#59).
function assetsFor(dir: string, renders: render.Context, base: string, styles: Omit<css.BundleOptions, 'entry' | 'url'>): (from: string, made: string[], page?: Blocks, loads?: [string, string][]) => Template.Assets {
	return (from, made, page, loads) => ({
		async load(filename: string, encoding?: BufferEncoding) {
			let file = join(dir, filename);
			fs.assert(file, `Missing "${filename}" asset`);
			let bytes = await fs.read(file);
			loads?.push([file, memo.hash(bytes)]);
			return encoding ? bytes.toString(encoding) : bytes;
		},
		async classes(filename: string) {
			let file = join(dir, filename);
			fs.assert(file, `Missing "${filename}" asset`);
			if (!css.isModule(file)) throw new Error(`${filename} is not a CSS module; name it *.module.css`);
			let { names, files } = await css.classes({ ...styles, entry: file, cssModules: true });
			loads?.push(...files);
			return names;
		},
		async render(template, output, options = {}) {
			let { html, file } = await templates.partial(template, options.args ?? {}, page);
			let name = await render.add(renders, { html, file, template, output, options, from, loads });
			made.push(name);
			return bundler.href(base, name);
		},
	});
}

function pageOf(item: ScanItem): Template.Page {
	return {
		path: item.path,
		params: item.params,
		content: '',
		url: item.url,
		summary: item.summary,
		title: item.title,
		section: item.section,
		tags: item.tags,
		headings: item.headings,
		draft: item.draft ?? false,
		scripts: '',
		styles: '',
	};
}

// A Markdown copy of a page: the title and summary of its frontmatter, then its body as written.
async function markdown(file: string): Promise<string> {
	let source = await fs.read(file, 'utf8');
	let { offset, value } = templates.frontmatter(source);
	let title = text(value.title);
	let summary = text(value.summary).replace(/\n/g, '\n> ');
	let body = source.slice(offset).replace(/^\s*\n/, '').trimEnd();
	return [title && `# ${title}`, summary && `> ${summary}`, body].filter(Boolean).join('\n\n') + '\n';
}

function parseTags(value: unknown): string[] {
	let list = Array.isArray(value) ? value.map(text) : text(value).split(',');
	return list.map(s => s.trim()).filter(Boolean);
}

export type BuildOptions = {
	// From `prepare()`; dev passes its cached copy, so a content edit does not re-run the config.
	inputs?: Inputs;
	// Where the files go; dev keeps them in memory. Defaults to the output folder on disk.
	sink?: output.Sink;
};

export type Inputs = {
	config: Required<Config>;
	$data: data.Data;
	/** Every file the config and data were read from, to watch in dev. */
	files: string[];
};

/**
 * Load the config and the `data/` folder for a build.
 * @example let inputs = await prepare({ cwd: 'site' }); await build({ cwd: 'site' }, { inputs });
 */
export async function prepare(argv: Argv): Promise<Inputs> {
	normalize(argv);
	let watch = log.watchdog({ debug: argv.debug });
	watch.step('loading the config and data/');
	try {
		var [loaded, store] = await Promise.all([load(argv.cwd), data.load(argv.data, argv.cwd)]);
	} finally {
		watch.stop();
	}
	return { config: loaded.config, $data: store.value, files: [...loaded.files, ...store.files] };
}

/**
 * Build the site into its output folder, `public/` unless `outdir` or `$build.outdir` names another.
 * @example await build({ cwd: 'site', minify: true });
 */
export async function build(argv: Argv, opts: BuildOptions = {}): Promise<void> {
	let t0 = Date.now();
	normalize(argv);
	// `bongo build` writes each page as it renders; dev holds every page, so a failed rebuild writes nothing
	let writes = !argv.dev ? utils.pool(WRITES) : undefined;
	let watch = log.watchdog({ debug: argv.debug });
	// the config names the output folder, so no folder changes until it loads
	let sink = opts.sink;
	try {
		let inputs = opts.inputs ?? await prepare(argv);
		if (!argv.dev) argv.dest = outdir(argv, inputs.config);
		// A dev rebuild writes over its last good build, so a failed one leaves that build serving.
		sink ??= output.disk(argv);
		await run(argv, inputs, sink, t0, watch, writes);
	} catch (err) {
		// leave no half-written pages; the build error matters more than a failed write or cleanup
		if (writes) {
			// a config that failed to load names no folder: empty the one of the flag, or of the last good build
			let dest = sink ? undefined : argv.outdir || await memo.dest(argv);
			if (dest) sink = output.disk({ ...argv, dest });
			await writes.drain().catch(() => {});
			await sink?.clear().catch(() => {});
			if (sink) MEMOS.delete(sink);
		}
		let fix = utils.runtime(err, argv.dev ? 'dev' : 'build');
		throw fix && err instanceof Error ? new Error(`${err.message}\n${fix}`, { cause: err }) : err;
	} finally {
		watch.stop();
	}
}

/**
 * The local files outside `content/` that the last build's data modules imported, for dev to watch.
 * @example for (let file of imports()) watch(file);
 */
export function imports(): string[] {
	return IMPORTS;
}

/**
 * The `assets/` files that the last good build read outside the bundler, with `$assets.load` and `$assets.render`, for dev to watch.
 * @example for (let file of loaded()) watch(file);
 */
export function loaded(): string[] {
	return LOADS;
}

// Outside of run(): closures made in run() kept the whole build alive in dev, about 440 MB on 10k pages, until the next build.
function loadedFiles(items: Record<string, memo.Item>, extra: [string, string][]): string[] {
	let files = new Set<string>();
	for (let rel in items) for (let [file] of items[rel].page?.loads ?? []) files.add(file);
	for (let [file] of extra) files.add(file);
	return [...files];
}

async function run(argv: Required<Argv>, inputs: Inputs, sink: output.Sink, t0: number, watch: log.Watchdog, writes: utils.Pool | undefined): Promise<void> {
	tags.reset();
	css.forget();

	// the memo of the last good build; `bongo build` keeps it on disk
	let previous = argv.fresh ? undefined : MEMOS.get(sink) ?? (writes ? await memo.load(argv) : undefined);
	if (!(argv.dev && OUTPUT.get(sink)?.dev)) {
		// `bongo build` writes over the files of the last build, which is much faster than making them again, then sweeps the rest; the memo lists them, so public/ need not be listed
		await (writes ? sink.reuse(previous?.made) : sink.clear());
		OUTPUT.delete(sink);
	}

	const { config, $data } = inputs;
	const { $site, $loaders: LOADERS } = config;
	// a page path resolves under `$site.url`, so a site in a subfolder keeps it
	let site = $site.url.endsWith('/') ? $site.url : $site.url + '/';
	let base = tags.publicPath($site.url);
	let slash = config.$build.trailingSlash !== false;
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	let renders = render.context({
		assets: argv.assets,
		cache: join(argv.cwd, 'node_modules', '.cache', 'bongo', 'render'),
		quality: images.settings({}, config.$images).quality,
	});

	// the options of each `<bongo:style>`, so that `$assets.classes` compiles a CSS module as the bundler will, and shares that compile with it
	let assets = assetsFor(argv.assets, renders, base, { targets: config.$build.target, minify: argv.minify || undefined, assets: LOADERS, utils: LOADER_UTILS });

	// renders and loads outside a page, as from a loader that calls a partial
	let loose: string[] = [];
	let loose_loads: [string, string][] = [];
	const context: templates.Context = { ...config, $data, $assets: assets('a loader', loose, undefined, loose_loads) };

	// sets `templates` caches
	watch.step('compiling layouts and partials');
	await templates.collect(argv, context);

	// the memo applies to pages, unless something that can change every page changed since
	let key = await memo.key(argv, inputs.files);
	let last = previous?.key === key ? previous : undefined;
	let next: memo.Memo = { key, registries: { pages: '', tags: '', sections: {}, outputs: '' }, bundles: {}, assets: {}, marks: {}, loose: false, items: {}, files: {}, sources: {}, made: [] };

	// the size of each output file that the build has read a stat of, for the size report
	let bytes: Map<string, number> = new Map();

	// the hash of each file that a page loads or an asset is made from, read once in a build
	let sums: Map<string, Promise<string>> = new Map();
	function sum(file: string): Promise<string> {
		let hit = sums.get(file);
		if (!hit) sums.set(file, hit = fs.read(file).then(memo.hash, () => ''));
		return hit;
	}

	// `bongo build` names an asset by its content, so each page that links an asset whose sources changed renders in full; dev names it by its entry, so no page does
	let moved = new Set(last && !argv.dev ? (await Promise.all(Object.entries(last.assets).map(async ([placeholder, files]) => {
		for (let [file, hash] of files) {
			if (await sum(file) !== hash) return [placeholder];
		}
		return [];
	}))).flat() : []);
	let links = (page: memo.Page | undefined) => !!page?.placeholders.some(placeholder => moved.has(placeholder));

	const isPage = /(hbs|html?)$/;
	const { Layouts, Partials } = templates;
	const { dest, content } = argv;
	const prior = OUTPUT.get(sink);
	const written: Set<string> = new Set();


	// Walk 1 — scan + loader + collect.
	// Produces an ordered list of ScanItem records without rendering layouts.
	// Pass-through assets (copies, direct writes) emit to disk immediately.
	let scanned: ScanItem[] = [];

	// Turns one content file into its record, or writes it, when it is no page: a loader's other result, or a copy.
	async function parse(input: string, rel: string, name: string, bytes: Buffer, hash: string): Promise<ScanItem | undefined> {
		let idx = rel.lastIndexOf('.');
		let urlpath = '/' + rel.substring(0, idx);
		let output = join(dest, rel);

		idx = name.lastIndexOf('.');
		let ext = name.substring(idx + 1);
		let basename = name.substring(0, idx);
		// `sitemap.xml.hbs` is an output file, but `v1.2.hbs` is a page, since `2` has no content type
		let inner = extname(basename).substring(1);
		let kind: ScanItem['kind'] = ext === 'hbs' && !/^html?$/i.test(inner) && mime.lookup(inner) ? 'output' : 'page';
		let params: Template.Params = {};
		let found: Loader.Heading[] | undefined;
		let src = '';

		if (DATA_MODULE.test(name)) {
			let file = rel.substring(0, rel.length - ext.length - 1);
			let path = '/' + file.replace(/\\/g, '/');
			return { input, rel, name, kind: 'data', ext, body: '', params, path: base + path.substring(1), url: new URL(path.substring(1), site).href, output: join(dest, file), section: deriveSection(rel), title: '', summary: '', tags: [], headings: [], hash };
		}

		if (isPage.test(ext)) {
			src = bytes.toString('utf8');
			let { offset, value } = templates.frontmatter(src);

			if (offset > 0) {
				Object.assign(params, value);
				src = src.substring(offset);
				// so a body starts after the line break of its frontmatter, and an output file can start with `<?xml`
				src = src.replace(/^\r?\n/, '');
			}

			// `.hbs` content is compiled in walk 2, once Pages/Sections/Tags
			// registries exist. `ext` stays 'hbs' through walk 1.
		} else if (LOADERS[ext]) {
			let initial = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

			debug('[content.loader]', ext, '~> found');

			let result = await loaders.run(input, initial, LOADERS, LOADER_UTILS, {
				isTerminal: (e) => isPage.test(e),
			});

			Object.assign(params, result.metadata);
			found = result.headings;
			ext = extname(result.filename).substring(1);

			if (isPage.test(ext)) {
				src = typeof result.content === 'string'
					? result.content
					: new TextDecoder().decode(result.content);
			} else {
				written.add(output);
				next.files[rel] = [hash, output, 0, 0];
				await sink.write(output, result.content);
				return;
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
			written.add(output);
			next.files[rel] = [hash, output, 0, 0];
			await sink.copy(input, output);
			return;
		}

		if (kind === 'output') {
			if (params.url != null) {
				throw new Error('Custom `url` is not allowed on output files; rename the file instead');
			}
			let file = rel.substring(0, rel.length - 4);
			urlpath = '/' + file.replace(/\\/g, '/');
			output = join(dest, file);
		} else {
			let file = false;
			if (typeof params.url === 'string') {
				urlpath = '/' + params.url.replace(/^.?\/+/, '');
				if (/^(https?:)?\/\//.test(urlpath)) {
					throw new Error('Custom `url` must be path only');
				}
				file = /\.html?$/i.test(urlpath);
			} else if (basename === 'index') {
				urlpath = urlpath.substring(0, urlpath.length - 5);
			}

			// a custom `/404.html` writes that file; any other path is a folder, or an `.html` file without its trailing slash
			if (file) {
				output = join(dest, urlpath);
			} else if (slash) {
				urlpath = urlpath.replace(/\/?$/, '/');
				output = join(dest, urlpath, 'index.html');
			} else {
				urlpath = urlpath.replace(/\/+$/, '') || '/';
				output = join(dest, urlpath === '/' ? 'index.html' : urlpath + '.html');
			}
		}

		let section = deriveSection(rel);

		return {
			input,
			rel,
			name,
			kind,
			ext,
			body: src,
			params,
			path: base + urlpath.substring(1),
			url: new URL(urlpath.substring(1), site).href,
			output,
			section,
			title: text(params.title),
			summary: text(params.summary),
			tags: parseTags(params.tags),
			headings: headings(found),
			hash,
		};
	}

	// A content file that the memo has as it is: a page goes into the registries and runs no loader, and its body loads only if it renders; a file that walk 1 wrote keeps its output.
	async function recall(input: string, rel: string, name: string, hash: string): Promise<boolean> {
		let hit = last?.loose ? undefined : last?.items[rel];
		if (hit?.hash === hash && !links(hit.page)) {
			scanned.push({ input, rel, name, kind: hit.kind, ext: hit.ext, params: hit.params, path: hit.path, url: hit.url, output: hit.output, section: hit.section, title: text(hit.params.title), summary: text(hit.params.summary), tags: hit.tags, headings: hit.headings, hash, record: hit.record });
			return true;
		}
		let file = last?.files[rel];
		let stat = file?.[0] === hash ? await sink.stat(file[1]) : undefined;
		if (file && stat?.[0] === file[2] && stat?.[1] === file[3]) {
			written.add(file[1]);
			next.files[rel] = file;
			await sink.keep(file[1]);
			return true;
		}
		return false;
	}

	// A file whose size and mtime are as the memo has them keeps its hash, unread; any other is read, a few at a time.
	async function scan(input: string, rel: string, name: string): Promise<void> {
		let info = await fs.stat(input);
		let note = (hash: string) => next.sources[rel] = info.mtimeMs < t0 - RACY ? [info.size, info.mtimeMs, hash] : [-1, -1, hash];
		let known = previous?.sources[rel];
		if (known?.[0] === info.size && known[1] === info.mtimeMs) {
			note(known[2]);
			if (await recall(input, rel, name, known[2])) return;
		}
		await reads(async () => {
			let bytes = await fs.read(input);
			let hash = memo.hash(bytes);
			note(hash);
			if (await recall(input, rel, name, hash)) return;
			let item = await parse(input, rel, name, bytes, hash);
			if (item) scanned.push(item);
		});
	}

	// The body of a page: from walk 1, or for a page whose source the memo had, loaded as walk 1 would have.
	async function bodyOf(item: ScanItem): Promise<string> {
		let body = item.body;
		item.body = undefined;
		return body ?? (await parse(item.input, item.rel, item.name, await fs.read(item.input), item.hash))?.body ?? '';
	}

	watch.step('reading content/');
	let reads = utils.limit(READS);
	await fs.list(content, (input, rel, name) => scan(input, rel, name).catch(err => {
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`${join('content', rel)}: ${reason}`, { cause: err });
	}));

	// a draft goes no further without `--drafts`: it makes no file, and no registry lists it
	for (let item of scanned) item.draft = item.kind !== 'data' && draft(item.params, t0);
	if (!argv.drafts) scanned = scanned.filter(item => !item.draft);

	// Between walks — build Pages and Sections registries.
	let Pages: Template.PageInfo[] = [];
	// a short hash of each page, which the memo keeps, so the three registries join 40 bytes for a page, not its whole record
	let records: Map<Template.PageInfo, string> = new Map();
	let Sections: Map<string, Template.PageInfo[]> = new Map();
	let Outputs: Build.File[] = [];

	for (let item of scanned) {
		if (item.kind === 'data') continue;
		if (item.kind === 'output') {
			Outputs.push({ path: item.path, params: item.params });
			continue;
		}

		let info: Template.PageInfo = {
			path: item.path,
			url: item.url,
			title: item.title,
			summary: item.summary,
			section: item.section,
			tags: item.tags,
			headings: item.headings,
			params: item.params,
			draft: item.draft ?? false,
		};
		Pages.push(info);
		item.record ??= memo.hash(JSON.stringify([info.path, info.url, info.title, info.summary, info.section, info.tags, info.headings, info.params]));
		// a page stops being a draft when its date passes, with its source as it was
		records.set(info, info.draft ? item.record + ' draft' : item.record);

		let list = Sections.get(item.section);
		if (!list) {
			list = [];
			Sections.set(item.section, list);
		}
		list.push(info);
	}

	// Sort each registry by path ascending for stable iteration.
	Pages.sort((a, b) => a.path.localeCompare(b.path));
	Outputs.sort((a, b) => a.path.localeCompare(b.path));
	for (let list of Sections.values()) {
		list.sort((a, b) => a.path.localeCompare(b.path));
	}

	// Build Tags registry — group PageInfo entries by tag.
	// Iterates Pages (already sorted), so each tag list inherits path-ascending order.
	let TagsMap: Map<string, Template.PageInfo[]> = new Map();
	for (let info of Pages) {
		for (let tag of info.tags) {
			let list = TagsMap.get(tag);
			if (!list) {
				list = [];
				TagsMap.set(tag, list);
			}
			list.push(info);
		}
	}

	// Tempura iterates arrays only; a plain object keyed by tag would not be
	// walkable via #each. Expose as [{ tag, pages }].
	let $tags: Template.TagEntry[] = [];
	for (let [tag, pages] of TagsMap) {
		$tags.push({ tag, pages });
	}

	// a hash of each registry, so a page that read one renders again when it changes
	let joined = (list: Template.PageInfo[]) => list.map(info => records.get(info)).join('\n');
	next.registries = {
		pages: memo.hash(joined(Pages)),
		outputs: memo.hash(JSON.stringify(Outputs)),
		tags: memo.hash($tags.map(entry => entry.tag + '\n' + joined(entry.pages)).join('\n\n')),
		sections: Object.fromEntries([...Sections].map(([name, list]) => [name, memo.hash(joined(list))])),
	};

	watch.step('rendering pages');

	// Walk 2 — render layouts with $pages + $section + $tags context.
	// A page renders again only when something that it read changed since the memo; any other page keeps its file.
	// Output files always render, since they read `$pages`.
	let pages: CollectedPage[] = [];
	let outputs: (CollectedPage & { html: string })[] = [];
	let modules: ScanItem[] = [];
	let later: ScanItem[] = [];
	let kept: { item: ScanItem; page: memo.Page }[] = [];
	let dirty: ScanItem[] = [];
	let alternates: Map<string, Named> = new Map();
	let bundles: Map<string, string[]> = new Map();
	let rendered: Map<string, string[]> = new Map();
	rendered.set('', loose);

	// Nothing that the page read or links changed, and its file is as the last build left it.
	async function clean(item: ScanItem, old: memo.Item, page: memo.Page): Promise<boolean> {
		if (!last || last.loose || links(page) || old.draft !== item.draft) return false;
		// `$hooks.transform` gets the output files, so with one, a page renders again when they change
		if (config.$hooks.transform && last.registries.outputs !== next.registries.outputs) return false;
		for (let read of page.reads) {
			let was = read === 'section' ? last.registries.sections[item.section] : last.registries[read];
			let now = read === 'section' ? next.registries.sections[item.section] : next.registries[read];
			if (was !== now) return false;
		}
		for (let [file, hash] of page.loads) {
			if (await sum(file) !== hash) return false;
		}
		let stat = await sink.stat(item.output);
		if (stat?.[0] !== page.stat[0] || stat?.[1] !== page.stat[1]) return false;
		bytes.set(item.output, stat[0]);
		return true;
	}

	// A page that keeps its file still registers its assets, renders, and alternates, for the bundler, output files, and the sweep.
	let replayed: Set<string> = new Set();
	let keeps: string[] = [];
	function replay(item: ScanItem, old: memo.Item, page: memo.Page): void {
		page.placeholders.forEach(placeholder => replayed.add(placeholder));
		bundles.set(item.rel, page.placeholders);
		rendered.set(item.rel, page.renders.map(([name]) => name));
		for (let [name, key] of page.renders) {
			renders.seen.set(name, { key, from: item.path });
			keeps.push(join(dest, name));
		}
		alternates.set(item.rel, { path: item.path, input: item.input, from: `content/${item.rel}`, found: page.found });
		keeps.push(item.output);
		next.items[item.rel] = old;
		kept.push({ item, page });
	}

	async function renderPage(item: ScanItem, body: string): Promise<void> {
		let $page = pageOf(item);
		let $section = Sections.get(item.section) || [];
		let made: string[] = [];
		let loads: [string, string][] = [];
		rendered.set(item.rel, made);
		let scope = templates.scope({ $page, $pages: Pages, $section, $tags }, page => assets(item.path, made, page, loads));
		let stop = templates.track();

		// `.hbs` content is compiled here, with full walk-2 context —
		// `$page`, `$pages`, `$section`, `$tags` are all available to the
		// body. Non-`.hbs` content bodies pass through raw.
		let rendered_content = item.ext === 'hbs'
			? await rendering(`content/${item.rel}`, async () => (await templates.compileContent(body))(
				{ ...context, ...scope.values, params: item.params },
				scope.blocks,
			))
			: body;

		rendered_content = tags.scanImages(rendered_content, argv as Required<Argv>, config, `content/${item.rel}`, item.path);
		$page.content = rendered_content;

		// lookup priority –> nearest folder first, then each parent, then "" for `/layouts/*` root
		let i=0, folders = item.rel.split(/[\\\/]+/g).slice(0, -1);
		let dirs = folders.map((_, n) => folders.slice(0, folders.length - n).join('/')).concat('');
		let basename = item.name.substring(0, item.name.lastIndexOf('.'));

		let render: Template.Compiler | void = undefined;
		let layout = '';
		let chain = [`content/${item.rel}`];

		if (isPage.test(item.ext)) {
			let j=0, files = ['index.hbs', 'html.hbs'];
			if (basename !== 'index') {
				files.splice(0, 0, `${basename}.hbs`, 'single.hbs');
			}

			outer: for (; i < dirs.length; i++) {
				for (j=0; j < files.length; j++) {
					layout = join(dirs[i], files[j]);
					debug('[content.layout]', item.rel, '~>', layout);
					if (render = Layouts.get(layout)) break outer;
				}
			}

			// Should always be defined as a fallback
			if (!render) throw new Error('Missing "html.hbs" template');
			chain.push(`layouts/${layout}`);
			let view = render;
			rendered_content = await rendering(chain.join(' → '), async () => view({ ...context, ...scope.values }, scope.blocks));
		}

		if (!layout.endsWith('html.hbs')) {
			$page.content = rendered_content;
			for (i=0; i < dirs.length; i++) {
				layout = join(dirs[i], 'html.hbs');
				debug('[content.layout]', item.rel, '~>', layout);
				if (render = Layouts.get(layout)) break;
			}
			// Should always be defined as a bare minimum
			if (!render) throw new Error('Missing "html.hbs" template');
			chain.push(`layouts/${layout}`);
			let view = render;
			rendered_content = await rendering(chain.join(' → '), async () => view({ ...context, ...scope.values }, scope.blocks));
		}

		// a page reads a registry that its body, a layout of its chain, or a partial that it called names
		let used = stop();
		let reads: Set<memo.Read> = new Set([
			...item.ext === 'hbs' ? templates.reads(body) : [],
			...chain.slice(1).flatMap(name => templates.readsOf(name.replace(/\\/g, '/'))),
			...[...used].flatMap(key => templates.readsOf('partials/' + key)),
		]);

		if (argv.dev) rendered_content += SCRIPT;

		let found: tags.Alternate[] = [];
		let markdown = /\.(md|markdown)$/i.test(item.input);
		rendered_content = tags.scanBongoTags(rendered_content, argv as Required<Argv>, config, chain.join(' → '), item.path, { alternates: found, markdown });
		rendered_content = tags.rewriteTransitionAttrs(rendered_content);
		alternates.set(item.rel, { path: item.path, input: item.input, from: `content/${item.rel}`, found });

		let placeholders = bundler.placeholders(rendered_content);
		bundles.set(item.rel, placeholders);
		for (let placeholder of placeholders) {
			let registration = bundler.registration(placeholder);
			if (registration) next.bundles[placeholder] = registration;
		}
		let inline = placeholders.filter(placeholder => rendered_content.includes(`data-bongo-inline="${placeholder}"`));
		let page: memo.Page = { reads: [...reads], loads, placeholders, inline, renders: [], found, stat: [0, 0] };
		next.items[item.rel] = { hash: item.hash, kind: item.kind, ext: item.ext, params: item.params, path: item.path, url: item.url, output: item.output, section: item.section, tags: item.tags, headings: item.headings, record: item.record ?? '', draft: item.draft ?? false, page };
		pages.push({ output: item.output, html: writes ? undefined : rendered_content, path: item.path, params: item.params, from: chain.join(' → '), rel: item.rel });
		await writes?.add(() => sink.write(item.output, rendered_content));
	}

	// Render `items` in order, while the bodies of the next few load, as walk 1 would read them.
	async function renderAll(items: ScanItem[]): Promise<void> {
		let bodies: Map<ScanItem, Promise<string>> = new Map();
		let ahead = 0;
		for (let item of items) {
			for (; ahead < items.length && bodies.size < READS; ahead++) {
				let body = bodyOf(items[ahead]);
				body.catch(() => {});
				bodies.set(items[ahead], body);
			}
			let body = await bodies.get(item) ?? '';
			bodies.delete(item);
			await renderPage(item, body);
		}
	}

	let cleans = await Promise.all(scanned.map(item => {
		let old = last?.items[item.rel];
		return item.kind === 'page' && old?.page && old.hash === item.hash ? clean(item, old, old.page) : false;
	}));
	for (let [i, item] of scanned.entries()) {
		if (item.kind === 'data') {
			modules.push(item);
			continue;
		}
		if (item.kind === 'output') {
			later.push(item);
			continue;
		}
		let old = last?.items[item.rel];
		if (cleans[i] && old?.page) replay(item, old, old.page);
		else dirty.push(item);
	}

	// each asset of the kept pages registers once, and their files are kept before any page renders
	for (let placeholder of replayed) {
		let registration = last?.bundles[placeholder];
		if (!registration) continue;
		bundler.register(...registration);
		next.bundles[placeholder] = registration;
	}
	await Promise.all(keeps.map(file => sink.keep(file)));

	// after every replay, so a page that renders sees the renders of each page that did not, as a full build would
	await renderAll(dirty);

	let copies: Map<string, { from: string; input: string }> = new Map();
	let ordered = [...alternates.values()].sort((a, b) => a.path.localeCompare(b.path));
	for (let named of ordered) {
		for (let alt of named.found) {
			if (alt.file === undefined) continue;
			let prev = copies.get(alt.file);
			if (prev && prev.from !== named.from) throw new Error(`"${alt.file}" is a Markdown copy of ${prev.from} and of ${named.from}`);
			copies.set(alt.file, { from: named.from, input: named.input });
		}
	}

	// Output files and data modules come after every page, so they see the alternates that each page names.
	let listed = new Map([...alternates.values()].map(named => [named.path, Object.fromEntries(named.found.map(alt => [alt.type, alt.href]))]));
	let final = new Map(Pages.map(info => [info, { ...info, alternates: listed.get(info.path) ?? {} }]));
	let swap = (list: Template.PageInfo[]) => list.map(info => final.get(info) ?? info);
	let $pages = swap(Pages);
	let $sections = new Map([...Sections].map(([name, list]) => [name, swap(list)]));
	let $tagged = $tags.map(entry => ({ tag: entry.tag, pages: swap(entry.pages) }));

	let output_loads: [string, string][] = [];
	for (let item of later) {
		let made: string[] = [];
		rendered.set(item.rel, made);
		let scope = templates.scope({ $page: pageOf(item), $pages, $section: $sections.get(item.section) || [], $tags: $tagged }, page => assets(item.path, made, page, output_loads));
		let html = await rendering(`content/${item.rel}`, async () => (await templates.compileContent(item.body ?? ''))(
			{ ...context, ...scope.values, params: item.params },
			scope.blocks,
		));
		outputs.push({ output: item.output, html, path: item.path, params: item.params, from: `content/${item.rel}` });
	}

	bundler.retain(new Set([...bundles.values()].flat()));

	// Data modules run on every build, narrow ones too, since they read `$pages`.
	let imported: Set<string> = new Set();
	let roots = [content, realpathSync(content)].map(dir => dir + sep);
	let note = (files: string[]) => files.forEach(file => roots.some(root => file.startsWith(root)) || imported.add(file));
	let json: [string, string][] = [];
	try {
		for (let item of modules) {
			try {
				var mod = await loadModule(item.input, argv.cwd);
				note(mod.files);
				if (!('default' in mod.exports)) throw new Error('needs a default export');
				let value = mod.exports.default;
				if (typeof value === 'function') value = await value({ $site, $pages, $section: $sections.get(item.section) || [], $tags: $tagged, $data, $utils: context.$utils });
				var serialized = JSON.stringify(value);
				if (serialized === undefined) throw new Error(`its default export is not JSON: ${typeof value}`);
			} catch (err) {
				if (err instanceof LoadError) note(err.files);
				let reason = err instanceof Error ? err.message : String(err);
				throw new Error(`content/${item.rel}: ${reason}`, { cause: err });
			}
			json.push([item.output, serialized]);
		}
	} finally {
		IMPORTS = [...imported];
	}

	// Flush: run every bundle group in parallel.
	let publicPath = tags.publicPath($site.url);
	if ('base' in sink) sink.base = publicPath;
	let cache = join(argv.cwd, 'node_modules', '.cache', 'bongo', 'images');
	watch.step('bundling assets');
	let flushResult = await bundler.flush({
		outDir: dest,
		cwd: argv.cwd,
		sink,
		publicPath,
		assets: LOADERS,
		utils: LOADER_UTILS,
		cache,
		dev: argv.dev,
		define: config.$build.define,
	});

	css.forget();

	if (flushResult.errors.length > 0) {
		for (let err of flushResult.errors) {
			log.error(err.message);
			if (err.frame) log.error(err.frame);
			if (err.file) log.error('  in ' + err.file);
		}
		let [first, ...rest] = flushResult.errors;
		let more = rest.length ? `, and ${rest.length} more error${rest.length > 1 ? 's' : ''}` : '';
		throw new Error(`Build failed: ${bundler.summary(first, argv.cwd)}${more}`);
	}

	for (let w of flushResult.warnings) {
		debug('[bundler.warning]', w.message);
	}

	for (let notice of flushResult.notices) log.info(notice);

	// what each placeholder puts in a page: a link to its output, and the content of an output that a page inlines; a page that kept its file renders again when one of its own changed
	let outs: Map<string, bundler.OutputInfo> = new Map(flushResult.outputs);
	let contents: Map<string, Promise<string>> = new Map();
	let inner = (placeholder: string) => {
		let file = outs.get(placeholder)?.filename;
		if (file === undefined) return Promise.resolve('');
		let hit = contents.get(file);
		if (!hit) contents.set(file, hit = sink.read(join(dest, file)).then(memo.hash, () => ''));
		return hit;
	};
	let marks = new Map([...outs].map(([placeholder, out]) => [placeholder, memo.hash(JSON.stringify([out.filename, out.exports, out.image]))]));
	let inlines: Set<string> = new Set();
	for (let { page } of kept) page.inline.forEach(placeholder => inlines.add(placeholder));
	let relinked = new Set([...marks].filter(([placeholder, mark]) => last?.marks[placeholder]?.[0] !== mark).map(([placeholder]) => placeholder));
	let reinlined = new Set((await Promise.all([...inlines].map(async placeholder => await inner(placeholder) !== last?.marks[placeholder]?.[1] ? [placeholder] : []))).flat());
	let stale = relinked.size || reinlined.size ? kept.filter(({ page }) => page.placeholders.some(placeholder => relinked.has(placeholder)) || page.inline.some(placeholder => reinlined.has(placeholder))) : [];
	await renderAll(stale.map(({ item }) => item));

	watch.step('writing pages');
	// a streamed build outruns the GC, so rendering leaves much garbage; one full collection here lowers peak RSS by ~120 MB on 10k pages
	if (writes && pages.length >= COLLECT && typeof Bun !== 'undefined') Bun.gc(true);

	// Pass 2: substitute placeholders and write pages.
	let readOutput = async (filename: string) => String(await sink.read(join(dest, filename)));
	let { transform } = config.$hooks;

	async function finish(file: CollectedPage, kind: Build.Context['kind'], text: string): Promise<[string, string]> {
		if (!transform) return [file.output, text];
		try {
			var final = await transform(text, { kind, path: file.path, params: file.params, outputs: Outputs, config });
		} catch (err) {
			let reason = err instanceof Error ? err.message : String(err);
			throw new Error(`${reason}, rendering ${file.from}`, { cause: err });
		}
		return [file.output, final];
	}

	async function substitute(page: CollectedPage): Promise<[string, string]> {
		let html = await templates.substitute(page.html ?? String(await sink.read(page.output)), {
			outputs: flushResult.outputs,
			publicPath,
			readFile: readOutput,
		});
		return finish(page, 'page', html);
	}

	// every file is ready before any is written, so a failed dev rebuild leaves the last good build
	let ready = await Promise.all([
		...(writes ? [] : pages.map(substitute)),
		...outputs.map(file => finish(file, 'output', file.html)),
		...json,
	]);
	let taken = new Set([...written, ...scanned.map(item => item.output), ...flushResult.files.map(file => join(dest, file))]);
	for (let name of renders.files.keys()) {
		if (taken.has(join(dest, name))) throw new Error(`"${name}" is a file of the site; render to another path`);
	}
	for (let [file, copy] of copies) {
		if (taken.has(join(dest, file)) || renders.files.has(file)) throw new Error(`"${file}" is a Markdown copy of ${copy.from}, and a file of the site`);
	}
	await utils.settle([
		...[...renders.files].map(([name, entry]) => sink.defer(join(dest, name), entry.make)),
		...[...copies].map(([file, copy]) => sink.defer(join(dest, file), () => images.slot(() => markdown(copy.input)))),
	]);
	if (writes) {
		await writes.drain();
		for (let page of pages) await writes.add(async () => sink.write(...await substitute(page)));
		await writes.drain();
	}
	await utils.settle(ready.map(([file, text]) => sink.write(file, text)));

	if (argv.minify) watch.step('minifying html');
	if (argv.minify && !await sink.minify(pages.map(page => page.output))) {
		log.info(`${dim('--minify:')} HTML left as-is; install tdewolff/minify to minify it`);
	}

	let files = new Set([...taken, ...[...rendered.values()].flat().map(name => join(dest, name)), ...[...copies.keys()].map(file => join(dest, file))]);
	await Promise.all([...prior?.files ?? []].filter(file => !files.has(file)).map(file => sink.remove(file)));
	if (writes) await sink.sweep();
	let keys = new Map([...renders.seen, ...[...renders.files].map(([name, { key, from }]) => [name, { key, from }] as const)]);
	OUTPUT.set(sink, { files, dev: argv.dev });

	// each page that rendered: its file as written, its assets, and its renders
	await Promise.all(pages.map(async page => {
		let entry = page.rel ? next.items[page.rel]?.page : undefined;
		if (!entry || !page.rel) return;
		entry.stat = await sink.stat(page.output) ?? [0, 0];
		bytes.set(page.output, entry.stat[0]);
		entry.inline.forEach(placeholder => inlines.add(placeholder));
		entry.renders = (rendered.get(page.rel) ?? []).map(name => [name, keys.get(name)?.key ?? '']);
	}));
	await Promise.all(Object.entries(next.files).map(async ([rel, [hash, output]]) => {
		let stat = await sink.stat(output) ?? [0, 0];
		next.files[rel] = [hash, output, ...stat];
		bytes.set(output, stat[0]);
	}));
	if (!argv.dev) {
		// a stylesheet without imports lists no dependencies, so the entry counts too
		let sources = (placeholder: string, out: bundler.OutputInfo) => {
			let entry = bundler.registration(placeholder)?.[0];
			let files = new Set([...entry ? [entry] : [], ...out.dependencies]);
			return Promise.all([...files].map(async (file): Promise<[string, string]> => [file, await sum(file)]));
		};
		next.assets = Object.fromEntries(await Promise.all([...outs].map(async ([placeholder, out]) => [placeholder, await sources(placeholder, out)])));
	}
	next.marks = Object.fromEntries(await Promise.all([...marks].map(async ([placeholder, mark]) => [placeholder, [mark, inlines.has(placeholder) ? await inner(placeholder) : '']])));
	if (writes) next.made = [...files].filter(file => file.startsWith(dest + sep)).map(file => relative(dest, file).split(sep).join('/'));
	next.loose = loose.length > 0 || loose_loads.length > 0;
	MEMOS.set(sink, next);
	LOADS = loadedFiles(next.items, [...output_loads, ...loose_loads]);
	if (writes) await memo.save(argv, next);

	// after this build's own files are out; a racing build re-encodes what it loses
	await Promise.all([images.prune(cache, config.$images), images.prune(renders.cache, config.$images)]);

	if (!argv.dev) {
		log.info(`${green('done')} ${dim('in ' + log.elapsed(Date.now() - t0))}`);
		watch.step('listing sizes');
		await log.sizes(argv.dest, process.cwd(), files, bytes);
	}
}
