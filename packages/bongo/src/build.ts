import { extname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { dim, green } from 'kleur/colors';

import * as fs from './utils/fs';
import * as log from './utils/log';
import * as bundler from './utils/bundler';
import { load } from './utils/config';
import * as loaders from './utils/loaders';
import * as templates from './utils/templates';
import * as tags from './utils/tags';
import { normalize } from './utils/argv';
import { RELOAD } from './utils/http';

import type { Argv, Build, Feed, Loader, Template } from 'bongo';

// Per-page frontmatter signatures from the last completed build. A narrow
// rebuild (`opts.only`) compares the target's current frontmatter hash against
// this snapshot. If they differ, the file's frontmatter changed — which may
// have shifted `tags` / `section` / `title` / anything else sibling pages
// render via `$pages` / `$section` / `$tags` — so we promote to a full rebuild
// to keep sibling output accurate. Body-only edits keep the narrow path.
let FRONTMATTER_SIG: Map<string, string> = new Map();

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
	feed: {                  // populated when frontmatter declares `feed.format`
		format: Feed.Format;
		title: string;
		attach: string;
		path: string;
	} | null;
};

function parseTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === 'string').map(s => s.trim()).filter(Boolean);
	}
	if (typeof value === 'string') {
		return value.split(',').map(s => s.trim()).filter(Boolean);
	}
	return [];
}

const FEED_FORMATS = new Set<Feed.Format>(['rss', 'atom', 'jsonl']);

// Treat a content file as a feed source when its frontmatter declares
// `feed.format` (e.g. `feed.format: atom`). We use flat dot-keys because
// bongo's frontmatter parser is line-based key:value and does NOT support
// nested objects.
function readFeedMeta(params: Template.Params, rel: string): {
	format: Feed.Format;
	title: string;
	attach: string;
	path: string;
} | null {
	let raw = params['feed.format'];
	if (typeof raw !== 'string') return null;

	let format = raw.trim() as Feed.Format;
	if (!FEED_FORMATS.has(format)) return null;

	let title = typeof params['feed.title'] === 'string' ? params['feed.title'] as string : '';
	let attach = typeof params['feed.attach'] === 'string' ? params['feed.attach'] as string : '';
	// `feed.path` overrides where the rendered feed is written. When omitted,
	// derive a sensible default from the file's rel path (drop the `.hbs`
	// extension chain so `blog/feed.xml.hbs` -> `/blog/feed.xml`).
	let raw_path = typeof params['feed.path'] === 'string' ? params['feed.path'] as string : '';
	let path: string;
	if (raw_path) {
		path = raw_path.startsWith('/') ? raw_path : '/' + raw_path;
	} else {
		let stripped = rel.replace(/\.hbs$/i, '');
		path = '/' + stripped.replace(/\\/g, '/');
	}

	return { format, title, attach, path };
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
};

export async function build(argv: Argv, opts: BuildOptions = {}): Promise<void> {
	let t0 = Date.now();
	normalize(argv);

	const config = await load(argv.cwd);
	const { $site, $assets: ASSETS } = config;
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	if (!opts.only) await fs.rmdir(argv.dest);

	config.$assets = {
		// @ts-ignore -> switcheroo
		load(filename: string, encoding?: BufferEncoding) {
			let file = join(argv.assets, filename);
			fs.assert(file, `Missing "${filename}" asset!`);
			return fs.read(file, encoding);
		}
	};

	// sets `templates` caches
	await templates.collect(argv, config);

	const isPage = /(hbs|html?)$/;
	const { Layouts, Partials } = templates;
	const { dest, content } = argv;

	const loader_utils: Loader.Utilities = {
		frontmatter: templates.frontmatter,

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

	await fs.list(content, async (input, rel, name) => {
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
				return fs.write(output, result.content);
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
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
			title: (params.title as string) || '',
			summary: (params.summary as string) || '',
			tags: parseTags(params.tags),
			sig: frontmatterSig(raw),
			feed: readFeedMeta(params, rel),
		});
	});

	// Narrow-rebuild safety: if opts.only was set but the target's frontmatter
	// hash diverges from the last build's snapshot (or the target no longer
	// scans as a page), promote to a full rebuild so sibling pages don't keep
	// stale HTML that references gone-tags / renamed-section / etc.
	let narrowOnly = opts.only;
	if (narrowOnly) {
		let target = scanned.find(s => s.rel === narrowOnly);
		let prev = FRONTMATTER_SIG.get(narrowOnly);
		if (!target || prev === undefined || prev !== target.sig) {
			narrowOnly = undefined;
			debug('[build.narrow] frontmatter changed; promoting to full rebuild');
		}
	}

	// Between walks — build Pages and Sections registries.
	// Feed-source files are excluded from Pages/$section/$tags so they don't
	// pollute iterations like `{{#each $pages}}`. They are still rendered in
	// walk 2 (with full context), captured as Build.FeedSource records, and
	// handed off to plugins via the `pages` / `output` hooks.
	let Pages: Template.PageInfo[] = [];
	let Sections: Map<string, Template.PageInfo[]> = new Map();
	let PageInfoByRel: Map<string, Template.PageInfo> = new Map();

	for (let item of scanned) {
		if (item.feed) continue;
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
		PageInfoByRel.set(item.rel, info);

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

	// Collect Feed sources discovered via frontmatter. Bodies are populated in
	// walk 2 below; the `pages` hook fires *before* walk 2 so plugins can use
	// `context.feeds` to populate `page.feeds` (which `$page.feeds` reads) on
	// any matching pages.
	let Feeds: Build.FeedSource[] = [];
	for (let item of scanned) {
		if (!item.feed) continue;
		Feeds.push({
			rel: item.rel,
			path: item.feed.path,
			format: item.feed.format,
			title: item.feed.title,
			attach: item.feed.attach,
			params: item.params,
			body: '', // filled in walk 2
		});
	}

	let context: Build.Context = {
		config,
		pages: Pages,
		sections: Sections,
		tags: $tags,
		feeds: Feeds,
	};

	// `pages` hook: plugins can mutate `Pages` entries (e.g. attach
	// `page.feeds = [...]`) before walk 2 renders any layout that reads from
	// `$page.feeds`. Composed across plugins by `merge()` in config.ts.
	if (config.$hooks.pages) await config.$hooks.pages(context);

	// Walk 2 — render layouts with $pages + $section + $tags context.
	// If `only` is set, skip rendering every item except the matching one — walk 1
	// above already populated the registries so sibling awareness stays correct.
	let pages: CollectedPage[] = [];

	// Feed sources are rendered into `Feeds[i].body` and skip the rest of the
	// page pipeline (no layout wrap, no dev reload script, no <bongo:*>
	// rewrite, no default write). Plugins consume them via the `output` hook.
	let feedByRel: Map<string, Build.FeedSource> = new Map();
	for (let f of Feeds) feedByRel.set(f.rel, f);

	for (let item of scanned) {
		if (narrowOnly && item.rel !== narrowOnly) continue;

		// Feed body: render with full walk-2 context, then capture and skip
		// the rest of the per-page pipeline.
		if (item.feed) {
			let feedRecord = feedByRel.get(item.rel);
			if (!feedRecord) continue;
			let $section = Sections.get(item.section) || [];
			let $page: Template.Page = {
				path: item.path,
				params: item.params,
				content: '',
				url: new URL(item.path, $site.url).href,
				summary: item.summary,
				title: item.title,
				section: item.section,
				tags: item.tags,
				feeds: [],
				scripts: '',
				styles: '',
			};
			let body = item.ext === 'hbs'
				? await (await templates.compileContent(item.body))(
					{ $page, $pages: Pages, $section, $tags, params: item.params, ...config }
				)
				: item.body;
			feedRecord.body = body;
			continue;
		}

		let info = PageInfoByRel.get(item.rel);
		// Should always be defined — every non-feed scanned item is in PageInfoByRel.
		if (!info) throw new Error(`Missing page info for "${item.rel}"`);

		let $page: Template.Page = {
			path: info.path,
			params: info.params,
			content: '',                       // filled below (and again after layout)
			url: info.url,
			summary: info.summary,
			title: info.title,
			section: info.section,
			tags: info.tags,
			feeds: info.feeds || [],
			scripts: '',
			styles: '',
		};

		let $section = Sections.get(item.section) || [];

		// `.hbs` content is compiled here, with full walk-2 context —
		// `$page`, `$pages`, `$section`, `$tags` are all available to the
		// body. Non-`.hbs` content bodies pass through raw.
		let rendered_content = item.ext === 'hbs'
			? await (await templates.compileContent(item.body))(
				{ $page, $pages: Pages, $section, $tags, params: item.params, ...config }
			)
			: item.body;
		$page.content = rendered_content;

		// lookup priority –> need "" for `/layouts/*` root
		let i=0, dirs = item.rel.split(/[\\\/]+/g).slice(0, -1).concat('');
		let basename = item.name.substring(0, item.name.lastIndexOf('.'));

		let render: Template.Compiler | void = undefined;
		let layout = '';

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
			rendered_content = await render({ $page, $pages: Pages, $section, $tags, ...config });
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
			rendered_content = await render({ $page, $pages: Pages, $section, $tags, ...config });
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
			rendered_content +=     `o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(20,20,20,.92);color:#f4f4f4;font:14px/1.5 ui-monospace,monospace;padding:24px;overflow:auto;white-space:pre-wrap';`;
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

		rendered_content = tags.scanBongoTags(rendered_content, argv as Required<Argv>, config);
		rendered_content = tags.rewriteTransitionAttrs(rendered_content);

		pages.push({ output: item.output, html: rendered_content });
	}

	// Flush: run every bundle group in parallel.
	let flushResult = await bundler.flush({
		outDir: dest,
		assets: ASSETS,
		utils: loader_utils,
	});

	if (flushResult.errors.length > 0) {
		for (let err of flushResult.errors) {
			log.error(err.message);
			if (err.file) log.error('  in ' + err.file);
		}
		throw new Error(`Build failed: ${flushResult.errors.length} bundler error(s)`);
	}

	for (let w of flushResult.warnings) {
		debug('[bundler.warning]', w.message);
	}

	// Pass 2: substitute placeholders and write pages.
	let publicPath = derivePublicPath($site.url);
	let readOutput = (filename: string) => fs.read(join(dest, filename), 'utf8');

	await Promise.all(pages.map(async page => {
		let html = await templates.substitute(page.html, {
			outputs: flushResult.outputs,
			publicPath,
			readFile: readOutput,
		});
		await fs.write(page.output, html);
	}));

	// `output` hook: plugins write derived files (feeds, sitemaps, etc).
	// Runs after all primary HTML is on disk so plugins can read those files
	// back if needed. The `write(path, content)` closure resolves any leading
	// '/' against `dest` so plugins use site-relative URL paths.
	if (config.$hooks.output) {
		let outputContext: Build.OutputContext = {
			...context,
			write(path, content) {
				return fs.write(join(dest, path.replace(/^\/+/, '')), content);
			},
		};
		await config.$hooks.output(outputContext);
	}

	if (argv.minify) {
		const exec = require('node:util').promisify(
			require('node:child_process').exec
		);

		try {
			let { stdout, stderr } = await exec('minify --version');
			if (stderr.length || stdout.length < 1) throw 1;
		} catch (err) {
			log.error('`--minify` requires the `minify` CLI on your $PATH.');
			log.error('See https://github.com/tdewolff/minify for install instructions.');
			return process.exit(1);
		}

		let cwd = process.cwd();
		let input = relative(cwd, argv.dest);
		log.info(`compressing... ${input}`);
		let output = relative(cwd, argv.cwd) || '.';
		await exec(`minify -r "${input}" -o "${output}"`);
	}

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
