import { extname, join, relative } from 'node:path';

import * as fs from './utils/fs';
import * as log from './utils/log';
import * as bundler from './utils/bundler';
import { load } from './utils/config';
import * as templates from './utils/templates';
import { normalize } from './utils/argv';
import { RELOAD } from './utils/http';

import type { Argv, Loader, Template } from 'bongo';

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
	ext: string;             // final extension (post-loader chain) — e.g. 'md' -> 'html'
	content: string;         // compiled-content-ready string (frontmatter stripped, loaders run, .hbs compiled)
	params: Template.Params;
	path: string;            // URL path (e.g. '/blog/post-1/')
	output: string;          // absolute output path
	section: string;         // derived from rel's dirname
	title: string;
	summary: string;
	tags: string[];          // parsed from frontmatter.tags
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

export async function build(argv: Argv): Promise<void> {
	normalize(argv);

	const config = await load(argv.cwd);
	const { $site, $assets: ASSETS } = config;
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	await fs.rmdir(argv.dest);

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

		if (isPage.test(ext)) {
			src = await fs.read(input, 'utf8');
			let { offset, value } = templates.frontmatter(src);

			if (offset > 0) {
				Object.assign(params, value);
				src = src.substring(offset);
			}

			if (ext === 'hbs') {
				let render = await templates.compileContent(src);
				src = await render({ params, ...config });
				// After compiling .hbs content, the output extension is html
				ext = 'html';
			}
		} else if (ASSETS[ext]) {
			let loader, filename = input;
			let prev, data = new Uint8Array(
				await fs.read(input)
			) as Uint8Array | string;

			debug('[content.loader]', ext, '~> found');

			while (prev !== ext) {
				if (isPage.test(ext)) break;

				// TODO: ASSETS after config
				// TODO: loader receives utils
				if (loader = ASSETS[prev = ext]) {
					let result = await loader(filename, data, loader_utils);
					filename = result.filename;
					data = result.content;
					if (result.metadata) {
						Object.assign(params, result.metadata);
					}
				}

				ext = extname(filename).substring(1);
				debug('[content.looper]', prev, '~>', ext);
			}

			if (isPage.test(ext)) {
				src = typeof data === 'string' ? data : new TextDecoder().decode(data);
			} else {
				return fs.write(output, data);
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
			content: src,
			params,
			path: urlpath,
			output,
			section,
			title: (params.title as string) || '',
			summary: (params.summary as string) || '',
			tags: parseTags(params.tags),
		});
	});

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

	// Convert to an array of {tag, pages, pathsCsv} entries for tempura #each compatibility.
	// (Tempura iterates arrays only; plain object keys are not iterable via #each.)
	// pathsCsv is a convenience field: page paths joined with ',' for templates that
	// cannot use nested #each (tempura shares $$a across nesting levels).
	let $tags: Template.TagEntry[] = [];
	for (let [tag, pages] of TagsMap) {
		$tags.push({ tag, pages, pathsCsv: pages.map(p => p.path).join(',') });
	}

	// Walk 2 — render layouts with $pages + $section + $tags context.
	let pages: CollectedPage[] = [];

	for (let item of scanned) {
		let $page: Template.Page = {
			path: item.path,
			params: item.params,
			content: item.content,
			url: new URL(item.path, $site.url).href,
			summary: item.summary,
			title: item.title,
			section: item.section,
			tags: item.tags,
			scripts: '',
			styles: '',
		};

		let $section = Sections.get(item.section) || [];

		let rendered_content = item.content;

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

		pages.push({ output: item.output, html: rendered_content });
	}

	// Flush: run every bundle group in parallel.
	let flushResult = await bundler.flush({ outDir: dest });

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

	if (argv.minify) {
		const exec = require('node:util').promisify(
			require('node:child_process').exec
		);

		try {
			let { stdout, stderr } = await exec('minify --version');
			if (stderr.length || stdout.length < 1) throw 1;
		} catch (err) {
			// TODO: formatting
			console.error('You must have `minify` available in your $PATH for `--minify` to work.');
			console.error('Visit ~https://github.com/tdewolff/minify~ for installation instructions.');
			return process.exit(1);
		}

		let cwd = process.cwd();
		let input = relative(cwd, argv.dest);
		console.log('~> compressing...', input);
		let output = relative(cwd, argv.cwd) || '.';
		await exec(`minify -r "${input}" -o "${output}"`);
	}

	console.log('~> DONE~!');
}
