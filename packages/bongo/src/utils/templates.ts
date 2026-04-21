import { parse, join, relative } from 'node:path';
import * as tempura from './tempura/index';
import * as bundler from './bundler';
import * as log from './log';
import * as fs from './fs';

import type { Argv, Config, Template } from 'bongo';
import type { InputOptions, OutputOptions } from 'rolldown';
import type { Args } from './tempura/index';

// TODO: revert to `tempura.Compiler` postfix
type Cache = Map<string, Template.Compiler>;

export const Layouts: Cache = new Map;
export const Partials: Cache = new Map;

const Assets: {
	[input: string]: bundler.Group
} = {};

// Remove the extension
// TODO: normalize path separators
function toPartialName(file: string): string {
	let { ext } = parse(file);
	return file.substring(0, file.length - ext.length);
}

namespace Args {
	export interface Script {
		src?: string;
		defer?: boolean;
		target?: string;
		inline?: boolean;
		format?: string;
		async?: boolean;
	}

	export interface Style {
		src?: string;
		// TODO: outfile vs bundle vs ...
		output?: string;
		// TODO: enum
		preload?: boolean;
		inline?: boolean;
	}
}

export async function collect(argv: Required<Argv>, config: Required<Config>): Promise<void> {
	let inputOpts: InputOptions = {};
	let outputOpts: OutputOptions = {
		dir: argv.dest,
		minify: !!argv.minify,
	};

	// output fileName is relative to outDir (dest)
	let toOutfile = (file: string) => {
		return config.$utils.url.abs(file);
	}

	let blocks: Template.Partials = {
		/**
		 * Alternative partial format
		 * @note Partials do not have `$page` info
		 * @example {{#partial src="minutes" text="hello world" }}
		 * @example {{#partial src="minutes.hbs" text="hello world" }}
		 */
		partial(args) {
			let { src, ...rest } = args;
			let key = toPartialName(src);
			let render = Partials.get(key);
			if (render) return render(rest);
			throw new Error(`Unknown "${key}" partial!`);
		},

		/**
		 * @todo
		 * @example {{#style src="index.css"}}
		 */
		async style(args: Args.Style) {
			// TODO: figure out output="" for bundle vs ...
			let { src, preload, inline } = args;
			let input = join(argv.assets, src!);

			// NOTE: already setup()
			let group = Assets[input]!;
			let result = await bundler.build(group);

			let outfile = bundler.postbuild(input, result);

			if (inline) {
				outfile = join(argv.dest, outfile);
				let contents = await fs.read(outfile, 'utf8');
				return `<style>${contents}</style>`;
			}

			// ~> "/foo.[hash].css"
			outfile = toOutfile(outfile);

			let plain = `<link rel="stylesheet" href="${outfile}"/>`;
			if (!preload) return plain;

			let html = `<link rel="preload" href="${outfile}" as="style"`;
			html += ` onload="this.onload=null;this.rel='stylesheet'"/>`;
			html += `<noscript>${plain}</noscript>`;

			return html;
		},

		/**
		 * Process/bundle a script file.
		 * @example {{#script src="main.ts" target="es2019" format="esm" async=true }}
		 * @example {{#script src="demo.mjs" inline=true }}
		 */
		async script(args: Args.Script) {
			let { src, format, async, defer, inline } = args;
			let input = join(argv.assets, src!);

			// NOTE: already setup()
			let group = Assets[input]!;

			let result = await bundler.build(group);
			let outfile = bundler.postbuild(input, result);

			// NOTE: matches setup
			format = format || 'esm';

			// begin construction
			let html = '<script';
			if (async) html += ' async';
			if (format === 'esm') {
				html += ' type=module';
			} else if (defer) {
				html += ' defer';
			}

			if (inline) {
				outfile = join(argv.dest, outfile);
				let contents = await fs.read(outfile, 'utf8');
				html += '>' + contents + '</script>';
			} else {
				outfile = toOutfile(outfile);
				html += ` src="${outfile}"></script>`;
			}

			return html;
		}
	};

	blocks.style.setup = function (args: Args.Style) {
		let { src, output } = args;
		if (!src) throw new Error('Missing "src" argument');

		let input = join(argv.assets, src);
		if (Assets[input]) return;

		fs.assert(input, `assets/${src}`);

		let oo = { ...outputOpts };
		if (output) oo.assetFileNames = output;

		Assets[input] = bundler.prebuild(input, { input: { ...inputOpts }, output: oo });
	}

	blocks.script.setup = function (args: Args.Script) {
		let { src, target, format } = args;
		if (!src) throw new Error('Missing "src" argument');

		let input = join(argv.assets, src);
		if (Assets[input]) return;

		fs.assert(input, `assets/${src}`);

		Assets[input] = bundler.prebuild(input, {
			input: { ...inputOpts },
			output: {
				...outputOpts,
				format: (format || 'esm') as 'es' | 'cjs',
			},
		});
	}

	let props = ['$site', '$page', '$assets', '$utils'];
	let options: tempura.Options = { async: true, props, blocks };

	// TODO: improv error msg display
	async function compile(dir: string, rel: string) {
		try {
			let file = join(dir, rel);
			let content = await fs.read(file, 'utf8');
			return tempura.compile(content, options);
		} catch (err) {
			let type = parse(dir).name.slice(0, -1); // strip "s"
			let tmp = new Error(`Error compiling "${rel}" ${type}!`);
			if (!(err instanceof SyntaxError)) {
				tmp.message += '\n\t' + (err as Error).message;
			}
			throw tmp;
		}
	}

	let isHBS = /\.hbs$/i;
	let isJS = /\.([mc]?js|ts)$/i;
	let { layouts, partials } = argv;
	let debug = argv.debug ? log.debug : () => {};

	if (fs.exists(partials)) {
		await fs.list(partials, async (_, rel) => {
			if (isHBS.test(rel) || isJS.test(rel)) {
				let key = toPartialName(rel);
				debug('[collect.partials]', key);
				// @ts-ignore - setting placeholders
				Partials.set(key, blocks[key] = rel);
			}
		});

		for (let [key, rel] of Partials) {
			let file = String(rel);
			let render = isHBS.test(file)
				? await compile(partials, file)
				: await fs.load(file, partials);

			render = render.default || render;

			// NOTE: Partials do NOT have access to `$page` var
			let compiler = (x: Args) => render({ ...x, ...config }, blocks);
			Partials.set(key, blocks[key] = compiler);
		}
	}

	for (let name in config.$partials) {
		let key = toPartialName(name);
		debug('[collect.$partials]', key);
		let compiler = config.$partials[name];
		Partials.set(key, blocks[key] = compiler);
	}

	await fs.list(layouts, async (_, rel) => {
		if (isHBS.test(rel)) {
			debug('[collect.layouts]', rel);
			Layouts.set(rel, await compile(layouts, rel));
		}
	});
}

export function frontmatter(content: string): {
	offset: number;
	value: Template.Params
} {
	let value: Template.Params = {};

	if (content.substring(0, 3) !== '---') {
		return { offset: 0, value };
	}

	let match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(content);
	if (match == null) 	return { offset: 0, value };

	match[1].split('\n').forEach(pair => {
		let [key, ...v] = pair.split(':');
		value[key.trim()] = v.join(':').trim();
	});

	return { offset: match[0].length, value };
}
