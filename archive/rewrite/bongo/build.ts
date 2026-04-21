import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import * as esbuild from './esbuild';
import * as config from './config';
import * as utils from './utils';
import * as ENV from './argv';
import * as $ from './paths';

import type { Args } from 'tempura';
import type { Config as CC, Loader, Template } from './types';

console.log('---');

/**
 * Remove the extension
 * @TODO normalize path separators
 */
export function toPartialName(file: string): string {
	let extn = path.extname(file);
	return file.substring(0, file.length - extn.length);
}

// ---

export const Layouts = new Map<string, Template.Compiler>();
export const Partials = new Map<string, Template.Compiler>();

// Project configuration
let Config: Required<CC> | undefined;

// Default extension loaders
// TODO: support multiple per extn?
// ---
const Assets: Record<string, Loader> = {
	// html(file, data, utils) {
	// 	// console.log('> INSIDE HTML LOADER', { file });
	// 	return { filename: file, content: data };
	// },
};

// Default loader utilities
// ---
const Utilities: Loader.Utilities = {
	frontmatter: utils.frontmatter,
	render(name, ...args) {
		let view = Partials.get(name);
		// @ts-ignore - strict bind/apply rule
		if (view) return view.apply(view, args);
		throw new Error(`Unknown "${name}" partial!`);
	}
};

// Default template blocks
// ---

// esbuild cwd-relative -> absolute
// TODO: check (https?)?// prefix
function toOutfile(file: string) {
	file = path.relative($.PUBLIC, file);
	return Config!.$utils.url.abs(file);
}

/**
 * Alternative partial format
 * @note Partials do not have `$page` info
 * @example {{#partial src="minutes" text="hello world" }}
 * @example {{#partial src="minutes.hbs" text="hello world" }}
 */
utils.blocks['partial'] = function (args: Args) {
	let { src, ...rest } = args;
	let key = toPartialName(src);
	let render = Partials.get(key);
	if (render) return render(rest);
	throw new Error(`Unknown "${key} partial!`);
};

/**
 * @todo
 * @example {{#style src="index.css"}}
 */
utils.blocks['style'] = async function (args: Args) {
	let { src, output, preload, inline } = args;
	if (!src) throw new Error('Missing "src" argument');

	let config: esbuild.BuildOptions = {
		outdir: $.PUBLIC,
		absWorkingDir: $.ROOT,
		publicPath: new URL(Config!.$site.url).pathname,
		minify: ENV.MINIFY,
		charset: 'utf8',
	};

	if (output) {
		config.splitting = false;
		config.outfile = path.join($.PUBLIC, output);
	}

	let input = path.join($.ASSETS, src);
	let outfile = await esbuild.bundle(input, config);

	if (inline) {
		let contents = await utils.read(outfile);
		return '<style>' + contents + '</style>';
	}

	// ~> "/foo.[hash].css"
	outfile = toOutfile(outfile);

	let plain = `<link rel="stylesheet" href="${outfile}"/>`;
	if (!preload) return plain;

	let html = `<link rel="preload" href="${outfile}" as="style"`;
	html += ` onload="this.onload=null;this.rel='stylesheet'"/>`;
	html += `<noscript>${plain}</noscript>`;

	return html;
};

/**
 * Process/bundle a script file.
 * @example {{#script src="main.ts" target="es2019" format="esm" async=true }}
 * @example {{#script src="demo.mjs" inline=true }}
 */
utils.blocks['script'] = async function (args: Args) {
	let { src, format, target, async, defer, inline } = args;
	if (!src) throw new Error('Missing "src" argument');

	format = format || 'esm';

	let input = path.join($.ASSETS, src);
	let outfile = await esbuild.bundle(input, {
		outdir: $.PUBLIC,
		absWorkingDir: $.ROOT,
		publicPath: new URL(Config!.$site.url).pathname,
		target: target || 'es2017',
		charset: 'utf8',
		format,
	});

	// begin construction
	let html = '<script';
	if (async) html += ' async';
	if (format === 'esm') {
		html += ' type=module';
	} else if (defer) {
		html += ' defer';
	}

	if (inline) {
		let contents = await utils.read(outfile);
		return html + '>' + contents + '</script>';
	}

	//=> "/foo.[hash].js"
	outfile = toOutfile(outfile);
	return html + ` src="${outfile}"></script>`;
};

export async function setup() {
	Config = await config.load($.ROOT);
	Object.assign(Assets, Config.$assets);

	// Compile any partials
	// ---
	if (utils.exists($.PARTIALS)) {
		// collect partials -> placeholder for valid blocks
		await utils.ls($.PARTIALS, (abs, rel) => {
			let key = toPartialName(rel);
			// @ts-ignore --> placeholder key
			Partials.set(key, utils.blocks[key] = abs);
		});

		for (let [key, file] of Partials) {
			// TODO: handle *.hbs vs *.[tj]s
			let render = await utils.view('' + file);
			// TODO: pass thru config.$site et al
			Partials.set(key, utils.blocks[key] = render);
		}
	}

	// Compile "/layouts/**" files
	// TODO: accept JS/TS files
	// ---
	await utils.ls($.LAYOUTS, async (abs, rel) => {
		if ($.isHBS.test(rel)) Layouts.set(rel, await utils.view(abs));
	});
}

type Extension = `.${string}`;

export interface Result {
	file: string;
	data: Buffer | string;
}

export async function compile(file: string): Promise<Result> {
	// Config ||= await load();
	// TODO: merge Config.$assets
	const { $site, $utils } = Config!;

	let relname = path.relative($.CONTENT, file); // "foo/bar.jpg"
	let outfile = path.join($.PUBLIC, relname);

	let details = path.parse(relname);

	let name = details.name; // "bar"
	let extn = details.ext as Extension; // ".jpg"

	let content: Buffer | string = await fs.readFile(file);

	let loader: Loader | undefined;
	let prev: Extension | undefined;
	let params: Template.Params = {};

	while (prev !== extn) {
		// TODO: collect non-`index` pages for "$section" (?)
		// TODO: run a loop for all `$section` pages first before render
		// 			-> for `index.*`, menus, sitemap, etc
		if ($.isPAGE.test(extn)) {
			if (typeof content !== 'string') {
				content = content.toString();
			}

			let { offset, value } = utils.frontmatter(content);

			if (offset > 0) {
				Object.assign(params, value);
				content = content.substring(offset);
			}

			if (extn === '.hbs') {
				content = await utils.compile(content)({ ...params, ...value });
				file = file.replace($.isHBS, '.html');
			}
		} else if (loader = Assets[extn.substring(1)]) {
			let result = await loader(file, content, Utilities) as Loader.Result;
			content = result.content;
			file = result.filename;
			if (result.metadata) {
				Object.assign(params, result.metadata);
			}
		}

		prev = extn;
		extn = path.extname(file) as Extension;
	}

	// stop here if not dealing with a ".hbs|html" file
	if (!$.isPAGE.test(file)) return { file, data: content };

	// ensure we're not dealing with Buffer content
	if (typeof content !== 'string') content = content.toString();

	let pathname = '/' + name; // "/bar"
	if (details.dir) pathname = '/' + details.dir + pathname; // "/foo/bar"

	if (typeof params.url === 'string') {
		pathname = '/' + params.url.replace(/^.?\/+/, '');
		if (/^(https?:)?\/\//.test(pathname)) {
			throw new Error('Custom `url` must be path only');
		}
	}

	if (name === 'index') {
		// "/foobar/index" ~> "/foobar/"
		pathname = pathname.substring(0, pathname.length - 5);
	} else if (!pathname.endsWith('/')) {
		pathname += '/'; // ensure trailing
	}

	outfile = path.join($.PUBLIC, pathname, 'index.html');

	let $page: Template.Page = {
		path: pathname, params, content,
		url: new URL(pathname, $site.url).href,
		summary: (params.summary as string) || '',
		title: (params.title as string) || '',
		scripts: '',
		styles: '',
	};

	// lookup "/layouts/**" tree; w/ priority
	// NOTE: need "" for `/layouts/*` root
	let i=0, dirs = relname.split(/[\\\/]+/g).slice(0, -1).concat('');
	let j=0, files=['index.hbs', 'html.hbs'];
	let render: Template.Compiler | void;
	let layout = ''; // layout path

	// "content/blog/hello.md" looks for:
	//   1. layouts/blog/hello.hbs
	//   1. layouts/blog/single.hbs
	//   1. layouts/hello.hbs
	//   1. layouts/single.hbs
	if (name !== 'index') files.splice(0, 1, `${name}.hbs`, 'single.hbs');

	outer: for (; i < dirs.length; i++) {
		for (j=0; j < files.length; j++) {
			layout = path.join(dirs[i], files[j]);
			// debug('[content.layout]', rel, '~>', layout);
			if (render = Layouts.get(layout)) break outer;
		}
	}

	// Should always be defined as a fallback
	if (!render) throw new Error('Missing "html.hbs" template');
	content = await render({ $page, $site, $utils });

	if (!layout.endsWith('html.hbs')) {
		$page.content = content;
		for (i=0; i < dirs.length; i++) {
			layout = path.join(dirs[i], 'html.hbs');
			// debug('[content.layout]', rel, '~>', layout);
			if (render = Layouts.get(layout)) break;
		}
		// Should always be defined as a bare minimum
		if (!render) throw new Error('Missing "html.hbs" template');
		content = await render({ $page, $site, $utils });
	}

	if (ENV.DEV) {
		content += `<script>`;
		content +=   `var es = new EventSource('/~bongo~/reload');`;
		content +=   `es.onopen = () => console.log('[dev] live reload enabled');`;
		content +=   `es.onmessage = () => location.reload();`;
		content += `</script>`;
	}

	if (Assets.html) {
		// NOTE: final HTML (post-)processing
		let result = await Assets.html(outfile, content, Utilities);
		outfile = result.filename;
		content = result.content;
	}

	return {
		file: outfile,
		data: content,
	};
}

export async function write(file: string) {
	let out = await compile(file);
	await utils.write(out.file, out.data);
}

/**
 * Complete build run-through
 */
export async function run() {
	await utils.clean($.PUBLIC);

	await setup();
	await utils.list($.CONTENT, write);

	if (ENV.MINIFY) {
		const child = await import('node:child_process');
		const { promisify } = await import('node:util');
		const exec = promisify(child.exec);

		try {
			let { stdout, stderr } = await exec('minify --version');
			if (stderr.length || stdout.length < 1) throw 1;
		} catch (err) {
			// TODO: formatting
			console.error('You must have `minify` available in your $PATH for `--minify` to work.');
			console.error('Visit ~https://github.com/tdewolff/minify~ for installation instructions.');
			process.exit(1);
		}

		let input = path.relative($.ROOT, $.PUBLIC);
		console.log('~> compressing...', input);
		await exec(`minify -r "${input}" -o "."`);
	}

	console.log('~> DONE!');
}
