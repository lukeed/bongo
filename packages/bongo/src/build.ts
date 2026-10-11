import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { dim, green } from 'kleur/colors';

import * as attrs from './utils/attrs';
import * as data from './utils/data';
import * as fs from './utils/fs';
import * as log from './utils/log';
import * as minify from './utils/minify';
import * as bundler from './utils/bundler';
import { load } from './utils/config';
import * as loaders from './utils/loaders';
import * as templates from './utils/templates';
import * as tags from './utils/tags';
import { normalize } from './utils/argv';
import { RELOAD } from './utils/http';

import type { Argv, Config, Loader, Template } from 'bongo';

// Per-page frontmatter signatures from the last completed build. A narrow
// rebuild (`opts.only`) compares the target's current frontmatter hash against
// this snapshot. If they differ, the file's frontmatter changed — which may
// have shifted `tags` / `section` / `title` / anything else sibling pages
// render via `$pages` / `$section` / `$tags` — so we promote to a full rebuild
// to keep sibling output accurate. Body-only edits keep the narrow path.
let FRONTMATTER_SIG: Map<string, string> = new Map();

// Per output dir, the last good build's files and each page's assets, to keep or delete on the next build.
type Output = { assets: Map<string, string[]>; files: Set<string>; dev: boolean };
let OUTPUT: Map<string, Output> = new Map();

function frontmatterSig(raw: string): string {
	let { offset } = templates.frontmatter(raw);
	let block = offset > 0 ? raw.substring(0, offset) : '';
	return createHash('sha256').update(block).digest('hex').slice(0, 16);
}

function derivePublicPath(siteUrl: string): string {
	if (!siteUrl) return '/';
	try {
		let u = new URL(siteUrl);
		let p = u.pathname;
		return p.endsWith('/') ? p : p + '/';
	} catch {
		return '/';
	}
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
};

type ScanItem = {
	input: string;           // absolute source path
	rel: string;             // path relative to content/
	name: string;            // basename with ext
	ext: string;             // final extension (post-loader chain) — 'hbs'|'html'|'htm'
	body: string;            // frontmatter stripped, loaders run; `.hbs` still raw for walk-2 compile
	params: Template.Params;
	path: string;            // URL path (e.g. '/blog/post-1/')
	output: string;          // absolute output path
	section: string;         // derived from rel's dirname
	title: string;
	summary: string;
	tags: string[];          // parsed from frontmatter.tags
	sig: string;             // sha256 of the raw frontmatter block (empty block ⇒ constant hash)
};

// Frontmatter is typed, so `title: 2024` is a number; page text fields take any scalar as text.
function text(value: unknown): string {
	let type = typeof value;
	return type === 'string' || type === 'number' || type === 'boolean' ? String(value) : '';
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

async function run(argv: Required<Argv>, opts: BuildOptions, watch: log.Watchdog): Promise<void> {
	let t0 = Date.now();

	const { config, $data } = opts.inputs ?? await prepare(argv);
	const { $site, $assets: ASSETS } = config;
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	// A dev rebuild writes over its last good build, so a failed one leaves that build serving.
	if (!opts.only && !(argv.dev && OUTPUT.get(argv.dest)?.dev)) {
		await fs.rmdir(argv.dest);
		OUTPUT.delete(argv.dest);
	}

	const context: templates.Context = {
		...config,
		$data,
		$assets: {
			// switcheroo: templates get a reader for assets/ in place of the loader map
			load(filename: string, encoding?: BufferEncoding) {
				let file = join(argv.assets, filename);
				fs.assert(file, `Missing "${filename}" asset!`);
				return encoding ? fs.read(file, encoding) : fs.read(file);
			}
		},
	};

	// sets `templates` caches
	watch.step('compiling layouts and partials');
	await templates.collect(argv, context);

	const isPage = /(hbs|html?)$/;
	const { Layouts, Partials } = templates;
	const { dest, content } = argv;
	const last = OUTPUT.get(dest);
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
		let params: Template.Params = {};
		let src = '';
		let raw = '';

		if (isPage.test(ext)) {
			src = await fs.read(input, 'utf8');
			raw = src;
			let { offset, value } = templates.frontmatter(src);

			if (offset > 0) {
				Object.assign(params, value);
				src = src.substring(offset);
			}

			// `.hbs` content is compiled in walk 2, once Pages/Sections/Tags
			// registries exist. `ext` stays 'hbs' through walk 1.
		} else if (ASSETS[ext]) {
			let initial = new Uint8Array(await fs.read(input)) as Uint8Array | string;

			// Capture raw file text before loaders transform it, so the
			// frontmatter signature below is computed on the untouched source.
			raw = new TextDecoder().decode(initial as Uint8Array);

			debug('[content.loader]', ext, '~> found');

			let result = await loaders.run(input, initial, ASSETS, loader_utils, {
				isTerminal: (e) => isPage.test(e),
			});

			Object.assign(params, result.metadata);
			ext = extname(result.filename).substring(1);

			if (isPage.test(ext)) {
				src = typeof result.content === 'string'
					? result.content
					: new TextDecoder().decode(result.content);
			} else {
				written.add(output);
				return fs.write(output, result.content);
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
			written.add(output);
			return fs.copy(input, output);
		}

		if (typeof params.url === 'string') {
			urlpath = '/' + params.url.replace(/^.?\/+/, '');
			if (/^(https?:)?\/\//.test(urlpath)) {
				throw new Error('Custom `url` must be path only');
			}
		}

		if (basename === 'index') {
			urlpath = urlpath.substring(0, urlpath.length - 5);
		} else if (!urlpath.endsWith('/')) {
			urlpath += '/'; // ensure trailing
		}

		output = join(dest, urlpath, 'index.html');

		let section = deriveSection(rel);

		scanned.push({
			input,
			rel,
			name,
			ext,
			body: src,
			params,
			path: urlpath,
			output,
			section,
			title: text(params.title),
			summary: text(params.summary),
			tags: parseTags(params.tags),
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

	for (let item of scanned) {
		let info: Template.PageInfo = {
			path: item.path,
			url: new URL(item.path, $site.url).href,
			title: item.title,
			summary: item.summary,
			section: item.section,
			tags: item.tags,
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
	// If `only` is set, skip rendering every item except the matching one — walk 1
	// above already populated the registries so sibling awareness stays correct.
	let pages: CollectedPage[] = [];
	let assets: Map<string, string[]> = new Map(narrowOnly && last ? last.assets : []);

	for (let item of scanned) {
		if (narrowOnly && item.rel !== narrowOnly) continue;

		let $page: Template.Page = {
			path: item.path,
			params: item.params,
			content: '',                       // filled below (and again after layout)
			url: new URL(item.path, $site.url).href,
			summary: item.summary,
			title: item.title,
			section: item.section,
			tags: item.tags,
			scripts: '',
			styles: '',
		};

		let $section = Sections.get(item.section) || [];

		// `.hbs` content is compiled here, with full walk-2 context —
		// `$page`, `$pages`, `$section`, `$tags` are all available to the
		// body. Non-`.hbs` content bodies pass through raw.
		let rendered_content = item.ext === 'hbs'
			? await (await templates.compileContent(item.body))(
				{ $page, $pages: Pages, $section, $tags, params: item.params, ...context }
			)
			: item.body;
		rendered_content = tags.scanImages(rendered_content, argv as Required<Argv>, config, `content/${item.rel}`, item.path);
		$page.content = rendered_content;

		// lookup priority –> need "" for `/layouts/*` root
		let i=0, dirs = item.rel.split(/[\\\/]+/g).slice(0, -1).concat('');
		let basename = item.name.substring(0, item.name.lastIndexOf('.'));

		let render: Template.Compiler | void = undefined;
		let layout = '';
		let chain = [`content/${item.rel}`];

		if (isPage.test(item.ext)) {
			let j=0, files = ['index.hbs', 'html.hbs'];
			if (basename !== 'index') {
				files.splice(0, 1, `${basename}.hbs`, 'single.hbs');
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
			rendered_content = await render({ $page, $pages: Pages, $section, $tags, ...context });
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
			rendered_content = await render({ $page, $pages: Pages, $section, $tags, ...context });
			chain.push(`layouts/${layout}`);
		}

		if (argv.dev) {
			rendered_content += `<script>`;
			rendered_content +=   `var es = new EventSource('${RELOAD}');`;
			rendered_content +=   `es.onopen = () => console.log('[dev] live reload enabled');`;
			rendered_content +=   `es.onmessage = (ev) => {`;
			rendered_content +=     `try {`;
			rendered_content +=       `var m = JSON.parse(ev.data);`;
			rendered_content +=       `if (m.type === 'reload') location.reload();`;
			rendered_content +=       `else if (m.type === 'hmr') console.warn('[dev] HMR not yet implemented; ignoring');`;
			rendered_content +=       `else if (m.type === 'error') __bongo_err(m.errors);`;
			rendered_content +=       `else if (m.type === 'error-clear') __bongo_err_clear();`;
			rendered_content +=     `} catch (e) {}`;
			rendered_content +=   `};`;
			rendered_content +=   `function __bongo_esc(s) { return String(s||'').replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]}); }`;
			rendered_content +=   `function __bongo_err(errs) {`;
			rendered_content +=     `__bongo_err_clear();`;
			rendered_content +=     `var o = document.createElement('div');`;
			rendered_content +=     `o.id = '__bongo_overlay';`;
			rendered_content +=     `o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#141414;color:#f4f4f4;font:14px/1.5 ui-monospace,monospace;padding:24px;overflow:auto;white-space:pre-wrap';`;
			rendered_content +=     `var html = '<h2 style=\\'margin:0 0 12px;color:#ff6b6b\\'>Build error</h2>';`;
			rendered_content +=     `for (var i=0;i<errs.length;i++) {`;
			rendered_content +=       `var e = errs[i];`;
			rendered_content +=       `html += '<div style=\\'margin-bottom:12px\\'>';`;
			rendered_content +=       `if (e.file) html += '<strong>'+__bongo_esc(e.file)+(e.line?':'+__bongo_esc(e.line):'')+'</strong>\\n';`;
			rendered_content +=       `html += __bongo_esc(e.message);`;
			rendered_content +=       `if (e.frame) html += '\\n'+__bongo_esc(e.frame);`;
			rendered_content +=       `html += '</div>';`;
			rendered_content +=     `}`;
			rendered_content +=     `o.innerHTML = html;`;
			rendered_content +=     `document.body.appendChild(o);`;
			rendered_content +=   `}`;
			rendered_content +=   `function __bongo_err_clear() {`;
			rendered_content +=     `var o = document.getElementById('__bongo_overlay');`;
			rendered_content +=     `if (o) o.remove();`;
			rendered_content +=   `}`;
			rendered_content += `</script>`;
		}

		rendered_content = tags.scanBongoTags(rendered_content, argv as Required<Argv>, config, chain.join(' → '), item.path);
		rendered_content = tags.rewriteTransitionAttrs(rendered_content);

		assets.set(item.rel, bundler.placeholders(rendered_content));
		pages.push({ output: item.output, html: rendered_content });
	}

	bundler.retain(new Set([...assets.values()].flat()));

	// Flush: run every bundle group in parallel.
	let publicPath = derivePublicPath($site.url);
	watch.step('bundling assets');
	let flushResult = await bundler.flush({
		outDir: dest,
		publicPath,
		assets: ASSETS,
		utils: loader_utils,
		cache: join(argv.cwd, 'node_modules', '.cache', 'bongo', 'images'),
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
	let readOutput = (filename: string) => fs.read(join(dest, filename), 'utf8');

	await Promise.all(pages.map(async page => {
		let html = await templates.substitute(page.html, {
			outputs: flushResult.outputs,
			publicPath,
			readFile: readOutput,
		});
		await fs.write(page.output, html);
	}));

	if (argv.minify) watch.step('minifying html');
	if (argv.minify && !await minify.html(pages.map(page => page.output))) {
		log.info(`${dim('--minify:')} HTML left as-is; install tdewolff/minify to minify it`);
	}

	let files = new Set([...written, ...scanned.map(item => item.output), ...flushResult.files.map(file => join(dest, file))]);
	await Promise.all([...last?.files ?? []].filter(file => !files.has(file)).map(file => fs.prune(file, dest)));
	OUTPUT.set(dest, { assets, files, dev: argv.dev });

	// Refresh the frontmatter-sig snapshot for the next narrow rebuild. Only
	// pages actually scanned in this build are updated; narrow builds don't
	// touch unrelated entries, so pages skipped by `narrowOnly` above retain
	// their prior sig (which matches since they weren't re-read).
	for (let item of scanned) FRONTMATTER_SIG.set(item.rel, item.sig);

	if (!argv.dev) {
		log.info(`${green('done')} ${dim('in ' + log.elapsed(Date.now() - t0))}`);
		log.sizes(argv.dest, process.cwd());
	}
}
