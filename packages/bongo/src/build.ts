import { createHash } from 'node:crypto';
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
import * as render from './utils/render';
import * as templates from './utils/templates';
import * as tags from './utils/tags';
import { normalize } from './utils/argv';
import { SCRIPT } from './utils/http';

import type { Argv, Build, Config, Loader, Template } from 'bongo';
import type { Blocks } from './utils/tempura/index';

// Per-page frontmatter signatures from the last completed build. A narrow
// rebuild (`opts.only`) compares the target's current frontmatter hash against
// this snapshot. If they differ, the file's frontmatter changed — which may
// have shifted `tags` / `section` / `title` / anything else sibling pages
// render via `$pages` / `$section` / `$tags` — so we promote to a full rebuild
// to keep sibling output accurate. Body-only edits keep the narrow path.
let FRONTMATTER_SIG: Map<string, string> = new Map();

// Per sink, the last good build's files, and each page's assets and renders, to keep or delete on the next build.
type Output = { assets: Map<string, string[]>; renders: Map<string, string[]>; keys: Map<string, { key: string; from: string }>; files: Set<string>; dev: boolean };
let OUTPUT: Map<output.Sink, Output> = new Map();

// Local files outside content/ that the last build's data modules read.
let IMPORTS: string[] = [];

// `search.json.ts` writes `search.json`
const DATA_MODULE = /\.json\.[jt]s$/;

function frontmatterSig(raw: string): string {
	let { offset } = templates.frontmatter(raw);
	let block = offset > 0 ? raw.substring(0, offset) : '';
	return createHash('sha256').update(block).digest('hex').slice(0, 16);
}

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
	html: string;     // rendered HTML, may contain placeholders
	path: string;
	params: Template.Params;
	from: string;     // what rendered it, for errors (eg, "content/index.md → layouts/html.hbs")
};

type ScanItem = {
	input: string;           // absolute source path
	rel: string;             // path relative to content/
	name: string;            // basename with ext
	kind: 'page' | 'output' | 'data';
	ext: string;             // final extension (post-loader chain) — 'hbs'|'html'|'htm'
	body: string;            // frontmatter stripped, loaders run; `.hbs` still raw for walk-2 compile
	params: Template.Params;
	path: string;            // URL path (e.g. '/blog/post-1/')
	url: string;             // absolute URL, under the subfolder of `$site.url` if any
	output: string;          // absolute output path
	section: string;         // derived from rel's dirname
	title: string;
	summary: string;
	tags: string[];          // parsed from frontmatter.tags
	headings: Template.Heading[];
	sig: string;             // sha256 of the raw frontmatter block (empty block ⇒ constant hash)
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

function parseTags(value: unknown): string[] {
	let list = Array.isArray(value) ? value.map(text) : text(value).split(',');
	return list.map(s => s.trim()).filter(Boolean);
}

export type BuildOptions = {
	// Narrow the build to a single content file's rel path (e.g. 'blog/post.md').
	// Walk 1 (scan + registries) still runs over every file so `$pages` / `$section`
	// / `$tags` stay accurate, but walk 2 renders only the matching page and
	// `public/` is not wiped. Used by the dev server for content-file edits.
	// Pass-through asset copies (images etc.) are still re-emitted since walk 1
	// handles them inline. If `only` doesn't match any content file, nothing is
	// rendered — call without `only` for a full rebuild in that case.
	only?: string;
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
	let watch = log.watchdog({ debug: argv.debug });
	try {
		await run(argv, opts, watch);
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

async function run(argv: Required<Argv>, opts: BuildOptions, watch: log.Watchdog): Promise<void> {
	let t0 = Date.now();

	// A dev rebuild writes over its last good build, so a failed one leaves that build serving.
	let sink = opts.sink ?? output.disk(argv);
	if (!opts.only && !(argv.dev && OUTPUT.get(sink)?.dev)) {
		await sink.clear();
		OUTPUT.delete(sink);
	}

	const { config, $data } = opts.inputs ?? await prepare(argv);
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

	// switcheroo: templates get a reader for assets/ in place of the loader map
	function assets(from: string, made: string[], page?: Blocks): Template.Assets {
		return {
			load(filename: string, encoding?: BufferEncoding) {
				let file = join(argv.assets, filename);
				fs.assert(file, `Missing "${filename}" asset!`);
				return encoding ? fs.read(file, encoding) : fs.read(file);
			},
			async render(template, output, options = {}) {
				let { html, file } = await templates.partial(template, options.args ?? {}, page);
				let name = await render.add(renders, { html, file, template, output, options, from });
				made.push(name);
				return bundler.href(base, name);
			},
		};
	}

	// renders outside a page, as from a loader that calls a partial
	let loose: string[] = [];
	const context: templates.Context = { ...config, $data, $assets: assets('a loader', loose) };

	// sets `templates` caches
	watch.step('compiling layouts and partials');
	await templates.collect(argv, context);

	const isPage = /(hbs|html?)$/;
	const { Layouts, Partials } = templates;
	const { dest, content } = argv;
	const last = OUTPUT.get(sink);
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

	async function scan(input: string, rel: string, name: string): Promise<void> {
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
		let raw = '';

		if (DATA_MODULE.test(name)) {
			let file = rel.substring(0, rel.length - ext.length - 1);
			let path = '/' + file.replace(/\\/g, '/');
			scanned.push({ input, rel, name, kind: 'data', ext, body: '', params, path: base + path.substring(1), url: new URL(path.substring(1), site).href, output: join(dest, file), section: deriveSection(rel), title: '', summary: '', tags: [], headings: [], sig: frontmatterSig('') });
			return;
		}

		if (isPage.test(ext)) {
			src = await fs.read(input, 'utf8');
			raw = src;
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
			let initial = new Uint8Array(await fs.read(input)) as Uint8Array | string;

			// Capture raw file text before loaders transform it, so the
			// frontmatter signature below is computed on the untouched source.
			raw = new TextDecoder().decode(initial as Uint8Array);

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
				return sink.write(output, result.content);
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
			written.add(output);
			return sink.copy(input, output);
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

		scanned.push({
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
			sig: frontmatterSig(raw),
		});
	}

	watch.step('reading content/');
	await fs.list(content, (input, rel, name) => scan(input, rel, name).catch(err => {
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`${join('content', rel)}: ${reason}`, { cause: err });
	}));

	// Narrow-rebuild safety: if opts.only was set but the target's frontmatter
	// hash diverges from the last build's snapshot (or the target no longer
	// scans as a page), promote to a full rebuild so sibling pages don't keep
	// stale HTML that references gone-tags / renamed-section / etc.
	let narrowOnly = opts.only;
	if (narrowOnly) {
		let target = scanned.find(s => s.rel === narrowOnly);
		let prev = FRONTMATTER_SIG.get(narrowOnly);
		if (!target || prev === undefined || prev !== target.sig || !last) {
			narrowOnly = undefined;
			debug('[build.narrow] frontmatter changed or no good build to narrow; promoting to full rebuild');
		}
	}

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

	watch.step('rendering pages');

	// Walk 2 — render layouts with $pages + $section + $tags context.
	// If `only` is set, skip rendering every page except the matching one — walk 1
	// above already populated the registries so sibling awareness stays correct.
	// Output files always render, since they read `$pages`.
	let pages: CollectedPage[] = [];
	let outputs: CollectedPage[] = [];
	let modules: ScanItem[] = [];
	let bundles: Map<string, string[]> = new Map(narrowOnly && last ? last.assets : []);
	let rendered: Map<string, string[]> = new Map(narrowOnly && last ? last.renders : []);
	rendered.set('', loose);
	for (let [rel, names] of rendered) {
		if (rel === narrowOnly || rel === '') continue;
		for (let name of names) {
			let hit = last?.keys.get(name);
			if (hit) renders.seen.set(name, hit);
		}
	}

	for (let item of scanned) {
		if (narrowOnly && item.rel !== narrowOnly && item.kind === 'page') continue;
		if (item.kind === 'data') {
			modules.push(item);
			continue;
		}

		let $page: Template.Page = {
			path: item.path,
			params: item.params,
			content: '',                       // filled below (and again after layout)
			url: item.url,
			summary: item.summary,
			title: item.title,
			section: item.section,
			tags: item.tags,
			headings: item.headings,
			scripts: '',
			styles: '',
		};

		let $section = Sections.get(item.section) || [];
		let made: string[] = [];
		rendered.set(item.rel, made);
		let scope = templates.scope({ $page, $pages: Pages, $section, $tags }, page => assets(item.path, made, page));

		// `.hbs` content is compiled here, with full walk-2 context —
		// `$page`, `$pages`, `$section`, `$tags` are all available to the
		// body. Non-`.hbs` content bodies pass through raw.
		let rendered_content = item.ext === 'hbs'
			? await (await templates.compileContent(item.body))(
				{ ...context, ...scope.values, params: item.params },
				scope.blocks,
			)
			: item.body;

		if (item.kind === 'output') {
			outputs.push({ output: item.output, html: rendered_content, path: item.path, params: item.params, from: `content/${item.rel}` });
			continue;
		}

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
			rendered_content = await render({ ...context, ...scope.values }, scope.blocks);
			chain.push(`layouts/${layout}`);
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
			rendered_content = await render({ ...context, ...scope.values }, scope.blocks);
			chain.push(`layouts/${layout}`);
		}

		if (argv.dev) rendered_content += SCRIPT;

		rendered_content = tags.scanBongoTags(rendered_content, argv as Required<Argv>, config, chain.join(' → '), item.path);
		rendered_content = tags.rewriteTransitionAttrs(rendered_content);

		bundles.set(item.rel, bundler.placeholders(rendered_content));
		pages.push({ output: item.output, html: rendered_content, path: item.path, params: item.params, from: chain.join(' → ') });
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
				if (typeof value === 'function') value = await value({ $site, $pages: Pages, $section: Sections.get(item.section) || [], $tags, $data, $utils: context.$utils });
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

	watch.step('writing pages');

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

	// every file is ready before any is written, so a failed dev rebuild leaves the last good build
	let ready = await Promise.all([
		...pages.map(async page => {
			let html = await templates.substitute(page.html, {
				outputs: flushResult.outputs,
				publicPath,
				readFile: readOutput,
			});
			return finish(page, 'page', html);
		}),
		...outputs.map(file => finish(file, 'output', file.html)),
		...json,
	]);
	let taken = new Set([...written, ...scanned.map(item => item.output), ...flushResult.files.map(file => join(dest, file))]);
	for (let name of renders.files.keys()) {
		if (taken.has(join(dest, name))) throw new Error(`"${name}" is a file of the site; render to another path`);
	}
	await Promise.all([...renders.files].map(([name, entry]) => sink.defer(join(dest, name), entry.make)));
	await Promise.all(ready.map(([file, text]) => sink.write(file, text)));

	if (argv.minify) watch.step('minifying html');
	if (argv.minify && !await sink.minify(pages.map(page => page.output))) {
		log.info(`${dim('--minify:')} HTML left as-is; install tdewolff/minify to minify it`);
	}

	let files = new Set([...taken, ...[...rendered.values()].flat().map(name => join(dest, name))]);
	await Promise.all([...last?.files ?? []].filter(file => !files.has(file)).map(file => sink.remove(file)));
	let keys = new Map([...renders.seen, ...[...renders.files].map(([name, { key, from }]) => [name, { key, from }] as const)]);
	OUTPUT.set(sink, { assets: bundles, renders: rendered, keys, files, dev: argv.dev });

	// Refresh the frontmatter-sig snapshot for the next narrow rebuild. Only
	// pages actually scanned in this build are updated; narrow builds don't
	// touch unrelated entries, so pages skipped by `narrowOnly` above retain
	// their prior sig (which matches since they weren't re-read).
	for (let item of scanned) FRONTMATTER_SIG.set(item.rel, item.sig);

	// after this build's own files are out; a racing build re-encodes what it loses
	await Promise.all([images.prune(cache, config.$images), images.prune(renders.cache, config.$images)]);

	if (!argv.dev) {
		log.info(`${green('done')} ${dim('in ' + log.elapsed(Date.now() - t0))}`);
		log.sizes(argv.dest, process.cwd());
	}
}
