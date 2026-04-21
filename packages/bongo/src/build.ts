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

type CollectedPage = {
	output: string;   // absolute path to write
	html: string;     // rendered HTML, may contain placeholders
};

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

	// TODO: save all `$page`|params into URL key
	// const Pages = new Map<url, info>;
	// TODO: save all `params.tag` into own cache
	// const Tags = new Map<tag, url>;

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

	// Pass 1: render every content file. Pages with placeholders collected;
	// pass-through assets (copies, direct writes) emit to disk immediately.
	let pages: CollectedPage[] = [];

	await fs.list(content, async (input, rel, name) => {
		let idx = rel.lastIndexOf('.');
		let path = '/' + rel.substring(0, idx);
		let output = join(dest, rel);

		idx = name.lastIndexOf('.');
		let ext = name.substring(idx + 1);
		let basename = name.substring(0, idx);
		let params: Template.Params = {};

		let render: Template.Compiler | void = undefined;
		let layout='', content='';

		// TODO: run a loop for all `$section` pages first before render
		// 			-> for `index.*`, menus, sitemap, etc
		// TODO: collect non-`index` pages for "$section" (?)
		if (isPage.test(ext)) {
			content = await fs.read(input, 'utf8');
			let { offset, value } = templates.frontmatter(content);

			if (offset > 0) {
				Object.assign(params, value);
				content = content.substring(offset);
			}

			if (ext === 'hbs') {
				console.log('[TODO] compile "*.hbs" content');
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
				content = typeof data === 'string' ? data : new TextDecoder().decode(data);
			} else {
				return fs.write(output, data);
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
			return fs.copy(input, output);
		}

		if (typeof params.url === 'string') {
			path = '/' + params.url.replace(/^.?\/+/, '');
			if (/^(https?:)?\/\//.test(path)) {
				throw new Error('Custom `url` must be path only');
			}
		}

		if (basename === 'index') {
			path = path.substring(0, path.length - 5);
		} else if (!path.endsWith('/')) {
			path += '/'; // ensure trailing
		}

		output = join(dest, path, 'index.html');

		let $page: Template.Page = {
			path, params, content,
			url: new URL(path, $site.url).href,
			summary: (params.summary as string) || '',
			title: (params.title as string) || '',
			scripts: '',
			styles: '',
		};

		// lookup priority –> need "" for `/layouts/*` root
		let i=0, dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat('');

		if (isPage.test(ext)) {
			let j=0, files = ['index.hbs', 'html.hbs'];
			if (basename !== 'index') {
				files.splice(0, 1, `${basename}.hbs`, 'single.hbs');
			}

			outer: for (; i < dirs.length; i++) {
				for (j=0; j < files.length; j++) {
					layout = join(dirs[i], files[j]);
					debug('[content.layout]', rel, '~>', layout);
					if (render = Layouts.get(layout)) break outer;
				}
			}

			// Should always be defined as a fallback
			if (!render) throw new Error('Missing "html.hbs" template');
			content = await render({ $page, ...config });
		}

		if (!layout.endsWith('html.hbs')) {
			$page.content = content;
			for (i=0; i < dirs.length; i++) {
				layout = join(dirs[i], 'html.hbs');
				debug('[content.layout]', rel, '~>', layout);
				if (render = Layouts.get(layout)) break;
			}
			// Should always be defined as a bare minimum
			if (!render) throw new Error('Missing "html.hbs" template');
			content = await render({ $page, ...config });
		}

		if (argv.dev) {
			content += `<script>`;
			content +=   `var es = new EventSource('${RELOAD}');`;
			content +=   `es.onopen = () => console.log('[dev] live reload enabled');`;
			content +=   `es.onmessage = (ev) => {`;
			content +=     `try {`;
			content +=       `var m = JSON.parse(ev.data);`;
			content +=       `if (m.type === 'reload') location.reload();`;
			content +=       `else if (m.type === 'hmr') console.warn('[dev] HMR not yet implemented; ignoring');`;
			content +=       `else if (m.type === 'error') __bongo_err(m.errors);`;
			content +=       `else if (m.type === 'error-clear') __bongo_err_clear();`;
			content +=     `} catch (e) {}`;
			content +=   `};`;
			content +=   `function __bongo_err(errs) {`;
			content +=     `__bongo_err_clear();`;
			content +=     `var o = document.createElement('div');`;
			content +=     `o.id = '__bongo_overlay';`;
			content +=     `o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(20,20,20,.92);color:#f4f4f4;font:14px/1.5 ui-monospace,monospace;padding:24px;overflow:auto;white-space:pre-wrap';`;
			content +=     `var html = '<h2 style=\\'margin:0 0 12px;color:#ff6b6b\\'>Build error</h2>';`;
			content +=     `for (var i=0;i<errs.length;i++) {`;
			content +=       `var e = errs[i];`;
			content +=       `html += '<div style=\\'margin-bottom:12px\\'>';`;
			content +=       `if (e.file) html += '<strong>'+e.file+(e.line?':'+e.line:'')+'</strong>\\n';`;
			content +=       `html += (e.message||'').replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]});`;
			content +=       `if (e.frame) html += '\\n'+e.frame.replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]});`;
			content +=       `html += '</div>';`;
			content +=     `}`;
			content +=     `o.innerHTML = html;`;
			content +=     `document.body.appendChild(o);`;
			content +=   `}`;
			content +=   `function __bongo_err_clear() {`;
			content +=     `var o = document.getElementById('__bongo_overlay');`;
			content +=     `if (o) o.remove();`;
			content +=   `}`;
			content += `</script>`;
		}

		pages.push({ output, html: content });
	});

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
