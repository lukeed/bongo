import { realpathSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { dim, green } from 'kleur/colors';
import * as mime from 'mrmime';

import * as attrs from './utils/attrs';
import * as data from './utils/data';
import * as fs from './utils/fs';
import * as images from './utils/images';
import * as log from './utils/log';
import * as output from './utils/output';
import * as bundler from './utils/bundler';
import { load, loadModule, LoadError } from './utils/config';
import * as loaders from './utils/loaders';
import * as memo from './utils/memo';
import * as render from './utils/render';
import * as templates from './utils/templates';
import * as tags from './utils/tags';
import * as utils from './utils/index';
import { normalize } from './utils/argv';
import { SCRIPT } from './utils/http';

import type { Argv, Build, Config, Loader, Template } from 'bongo';
import type { Blocks } from './utils/tempura/index';

// Per sink, the last good build's files, to delete the ones that the next build does not make.
type Output = { files: Set<string>; dev: boolean };

// Per sink, the memo of the last good build, so the next one renders only what changed; `bongo build` also saves it to disk.
let MEMOS: Map<output.Sink, memo.Memo> = new Map();

// The `<bongo:alternate>` elements that one page names, and the source that its Markdown copy comes from.
type Named = { path: string; input: string; from: string; found: tags.Alternate[] };
let OUTPUT: Map<output.Sink, Output> = new Map();

// Local files outside content/ that the last build's data modules read.
let IMPORTS: string[] = [];

// `search.json.ts` writes `search.json`
const DATA_MODULE = /\.json\.[jt]s$/;

// The pages that `bongo build` writes at once.
const WRITES = 64;

// The content files that a build reads and loads at once.
const READS = 16;

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

// switcheroo: templates get a reader for assets/ in place of the loader map
// Compiled partials keep the template context until the next build, so this lives outside `run` and keeps none of the build (#59).
function assetsFor(dir: string, renders: render.Context, base: string): (from: string, made: string[], page?: Blocks, loads?: [string, string][]) => Template.Assets {
	return (from, made, page, loads) => ({
		async load(filename: string, encoding?: BufferEncoding) {
			let file = join(dir, filename);
			fs.assert(file, `Missing "${filename}" asset!`);
			let bytes = await fs.read(file);
			loads?.push([file, memo.hash(bytes)]);
			return encoding ? bytes.toString(encoding) : bytes;
		},
		async render(template, output, options = {}) {
			let { html, file } = await templates.partial(template, options.args ?? {}, page);
			let name = await render.add(renders, { html, file, template, output, options, from });
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
	// Where the files go; dev keeps them in memory. Defaults to `public/` on disk.
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
		var [loaded, store] = await Promise.all([load(argv.cwd), data.load(argv.data)]);
	} finally {
		watch.stop();
	}
	return { config: loaded.config, $data: store.value, files: [...loaded.files, ...store.files] };
}

/**
 * Build the site into `public/`.
 * @example await build({ cwd: 'site', minify: true });
 */
export async function build(argv: Argv, opts: BuildOptions = {}): Promise<void> {
	normalize(argv);
	// `bongo build` writes each page as it renders; dev holds every page, so a failed rebuild writes nothing
	let writes = !argv.dev ? utils.pool(WRITES) : undefined;
	let watch = log.watchdog({ debug: argv.debug });
	try {
		await run(argv, opts, watch, writes);
	} catch (err) {
		// leave no half-written pages; the build error matters more than a failed write or cleanup
		if (writes) {
			await writes.drain().catch(() => {});
			await (opts.sink ?? output.disk(argv)).clear().catch(() => {});
		}
		throw err;
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

async function run(argv: Required<Argv>, opts: BuildOptions, watch: log.Watchdog, writes: utils.Pool | undefined): Promise<void> {
	let t0 = Date.now();
	tags.reset();

	// A dev rebuild writes over its last good build, so a failed one leaves that build serving.
	let sink = opts.sink ?? output.disk(argv);
	if (!(argv.dev && OUTPUT.get(sink)?.dev)) {
		// `bongo build` writes over the files of the last build, which is much faster than making them again, then sweeps the rest
		await (writes ? sink.reuse() : sink.clear());
		OUTPUT.delete(sink);
	}

	const inputs = opts.inputs ?? await prepare(argv);
	const { config, $data } = inputs;
	const { $site, $loaders: LOADERS } = config;
	// a page path resolves under `$site.url`, so a site in a subfolder keeps it
	let site = $site.url.endsWith('/') ? $site.url : $site.url + '/';
	let base = tags.publicPath($site.url);
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	let renders = render.context({
		assets: argv.assets,
		cache: join(argv.cwd, 'node_modules', '.cache', 'bongo', 'render'),
		quality: images.settings({}, config.$images).quality,
	});

	let assets = assetsFor(argv.assets, renders, base);

	// renders outside a page, as from a loader that calls a partial
	let loose: string[] = [];
	const context: templates.Context = { ...config, $data, $assets: assets('a loader', loose) };

	// sets `templates` caches
	watch.step('compiling layouts and partials');
	await templates.collect(argv, context);

	// the memo of the last good build, unless something that can change every page changed since
	let key = await memo.key(argv, inputs.files);
	let previous = argv.fresh ? undefined : MEMOS.get(sink) ?? (writes ? await memo.load(argv) : undefined);
	let last = previous?.key === key ? previous : undefined;
	let next: memo.Memo = { key, registries: { pages: '', tags: '', sections: {} }, loose: false, items: {}, files: {} };

	const isPage = /(hbs|html?)$/;
	const { Layouts, Partials } = templates;
	const { dest, content } = argv;
	const prior = OUTPUT.get(sink);
	const written: Set<string> = new Set();

	const loader_utils: Loader.Utilities = {
		frontmatter: templates.frontmatter,
		attrs: attrs.parse,

		render(name, ...args) {
			let view = Partials.get(name);
			// @ts-ignore - strict bind/apply rule
			if (view) return view.apply(view, args);
			throw new Error(`Unknown "${name}" partial!`);
		},

		decode(input) {
			return new TextDecoder().decode(input);
		},
	};

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
				// so an output file can start with `<?xml`
				if (kind === 'output') src = src.replace(/^\r?\n/, '');
			}

			// `.hbs` content is compiled in walk 2, once Pages/Sections/Tags
			// registries exist. `ext` stays 'hbs' through walk 1.
		} else if (LOADERS[ext]) {
			let initial = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

			debug('[content.loader]', ext, '~> found');

			let result = await loaders.run(input, initial, LOADERS, loader_utils, {
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
		} else if (typeof params.url === 'string') {
			urlpath = '/' + params.url.replace(/^.?\/+/, '');
			if (/^(https?:)?\/\//.test(urlpath)) {
				throw new Error('Custom `url` must be path only');
			}
			// `/404.html` writes that file; any other url is a folder
			if (!/\.html?$/i.test(urlpath) && !urlpath.endsWith('/')) urlpath += '/';
			output = urlpath.endsWith('/') ? join(dest, urlpath, 'index.html') : join(dest, urlpath);
		} else {
			if (basename === 'index') {
				urlpath = urlpath.substring(0, urlpath.length - 5);
			} else if (!urlpath.endsWith('/')) {
				urlpath += '/'; // ensure trailing
			}

			output = join(dest, urlpath, 'index.html');
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

	async function scan(input: string, rel: string, name: string): Promise<void> {
		let bytes = await fs.read(input);
		let hash = memo.hash(bytes);
		// a page whose source the memo has runs no loader: its record goes into the registries, and its body loads only if it renders
		let hit = last?.loose ? undefined : last?.items[rel];
		if (hit?.hash === hash) {
			scanned.push({ input, rel, name, kind: hit.kind, ext: hit.ext, params: hit.params, path: hit.path, url: hit.url, output: hit.output, section: hit.section, title: hit.title, summary: hit.summary, tags: hit.tags, headings: hit.headings, hash });
			return;
		}
		let file = last?.files[rel];
		let stat = file?.[0] === hash ? await sink.stat(file[1]) : undefined;
		if (file && stat?.[0] === file[2] && stat?.[1] === file[3]) {
			written.add(file[1]);
			next.files[rel] = file;
			await sink.keep(file[1]);
			return;
		}
		let item = await parse(input, rel, name, bytes, hash);
		if (item) scanned.push(item);
	}

	// The body of a page whose source the memo had, loaded as walk 1 would have.
	async function bodyOf(item: ScanItem): Promise<string> {
		return (await parse(item.input, item.rel, item.name, await fs.read(item.input), item.hash))?.body ?? '';
	}

	watch.step('reading content/');
	let reads = utils.limit(READS);
	await fs.list(content, (input, rel, name) => reads(() => scan(input, rel, name)).catch(err => {
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`${join('content', rel)}: ${reason}`, { cause: err });
	}));

	// Between walks — build Pages and Sections registries.
	let Pages: Template.PageInfo[] = [];
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
		};
		Pages.push(info);

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
	let record = (info: Template.PageInfo) => JSON.stringify([info.path, info.url, info.title, info.summary, info.section, info.tags, info.headings, info.params]);
	next.registries = {
		pages: memo.hash(Pages.map(record).join('\n')),
		tags: memo.hash($tags.map(entry => entry.tag + '\n' + entry.pages.map(record).join('\n')).join('\n\n')),
		sections: Object.fromEntries([...Sections].map(([name, list]) => [name, memo.hash(list.map(record).join('\n'))])),
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

	let sums: Map<string, Promise<string | undefined>> = new Map();
	function sum(file: string): Promise<string | undefined> {
		let hit = sums.get(file);
		if (!hit) sums.set(file, hit = fs.read(file).then(memo.hash, () => undefined));
		return hit;
	}

	// Nothing that the page read changed, and its file is as the last build left it.
	async function clean(item: ScanItem, page: memo.Page): Promise<boolean> {
		if (!last) return false;
		for (let read of page.reads) {
			let was = read === 'section' ? last.registries.sections[item.section] : last.registries[read];
			let now = read === 'section' ? next.registries.sections[item.section] : next.registries[read];
			if (was !== now) return false;
		}
		for (let [file, hash] of page.loads) {
			if (await sum(file) !== hash) return false;
		}
		let stat = await sink.stat(item.output);
		return stat?.[0] === page.stat[0] && stat?.[1] === page.stat[1];
	}

	// A page that keeps its file still registers its assets, renders, and alternates, for the bundler, output files, and the sweep.
	async function replay(item: ScanItem, old: memo.Item, page: memo.Page): Promise<void> {
		for (let [entry, cfg] of page.registrations) bundler.register(entry, cfg);
		bundles.set(item.rel, page.placeholders);
		rendered.set(item.rel, page.renders.map(([name]) => name));
		for (let [name, key] of page.renders) {
			renders.seen.set(name, { key, from: item.path });
			await sink.keep(join(dest, name));
		}
		alternates.set(item.rel, { path: item.path, input: item.input, from: `content/${item.rel}`, found: page.found });
		await sink.keep(item.output);
		next.items[item.rel] = old;
		kept.push({ item, page });
	}

	async function renderPage(item: ScanItem): Promise<void> {
		let body = item.body ?? await bodyOf(item);
		item.body = undefined;
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
		let registrations = placeholders.flatMap(placeholder => {
			let registration = bundler.registration(placeholder);
			return registration ? [registration] : [];
		});
		let inline = placeholders.filter(placeholder => rendered_content.includes(`data-bongo-inline="${placeholder}"`));
		let page: memo.Page = { reads: [...reads], loads, registrations, placeholders, inline, renders: [], found, signature: '', stat: [0, 0] };
		next.items[item.rel] = { hash: item.hash, kind: item.kind, ext: item.ext, params: item.params, path: item.path, url: item.url, output: item.output, section: item.section, title: item.title, summary: item.summary, tags: item.tags, headings: item.headings, page };
		pages.push({ output: item.output, html: writes ? undefined : rendered_content, path: item.path, params: item.params, from: chain.join(' → '), rel: item.rel });
		await writes?.add(() => sink.write(item.output, rendered_content));
	}

	for (let item of scanned) {
		if (item.kind === 'data') {
			modules.push(item);
			continue;
		}
		if (item.kind === 'output') {
			later.push(item);
			continue;
		}
		let old = last?.items[item.rel];
		if (old?.page && old.hash === item.hash && await clean(item, old.page)) await replay(item, old, old.page);
		else dirty.push(item);
	}

	// after every replay, so a page that renders sees the renders of each page that did not, as a full build would
	for (let item of dirty) await renderPage(item);

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

	for (let item of later) {
		let made: string[] = [];
		rendered.set(item.rel, made);
		let scope = templates.scope({ $page: pageOf(item), $pages, $section: $sections.get(item.section) || [], $tags: $tagged }, page => assets(item.path, made, page));
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
		utils: loader_utils,
		cache,
		dev: argv.dev,
	});

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

	// the outputs of a page's placeholders, and the content of those it inlines; a page that kept its file renders again when they change
	let outs: Map<string, bundler.OutputInfo> = new Map(flushResult.outputs);
	let contents: Map<string, Promise<string>> = new Map();
	let inlined = (file: string) => {
		let hit = contents.get(file);
		if (!hit) contents.set(file, hit = sink.read(join(dest, file)).then(memo.hash, () => ''));
		return hit;
	};
	let sign = async (page: memo.Page) => memo.hash(JSON.stringify(await Promise.all(page.placeholders.map(async placeholder => {
		let out = outs.get(placeholder);
		let sum = out && page.inline.includes(placeholder) ? await inlined(out.filename) : '';
		return [placeholder, out?.filename, out?.exports, out?.image, sum];
	}))));
	for (let { item, page } of kept) {
		if (await sign(page) !== page.signature) await renderPage(item);
	}

	watch.step('writing pages');
	// a streamed build outruns the GC, so rendering leaves much garbage; one full collection here lowers peak RSS by ~120 MB on 10k pages
	if (writes && typeof Bun !== 'undefined') Bun.gc(true);

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
	for (let page of pages) {
		let entry = page.rel ? next.items[page.rel]?.page : undefined;
		if (!entry || !page.rel) continue;
		entry.stat = await sink.stat(page.output) ?? [0, 0];
		entry.signature = await sign(entry);
		entry.renders = (rendered.get(page.rel) ?? []).map(name => [name, keys.get(name)?.key ?? '']);
	}
	for (let [rel, [hash, output]] of Object.entries(next.files)) next.files[rel] = [hash, output, ...await sink.stat(output) ?? [0, 0]];
	next.loose = loose.length > 0;
	MEMOS.set(sink, next);
	if (writes) await memo.save(argv, next);

	// after this build's own files are out; a racing build re-encodes what it loses
	await Promise.all([images.prune(cache, config.$images), images.prune(renders.cache, config.$images)]);

	if (!argv.dev) {
		log.info(`${green('done')} ${dim('in ' + log.elapsed(Date.now() - t0))}`);
		watch.step('listing sizes');
		await log.sizes(argv.dest, process.cwd());
	}
}
