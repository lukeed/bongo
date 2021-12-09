import { parse, join, relative } from 'path';
import * as tempura from './tempura/index';
import * as esbuild from './esbuild';
import * as log from './log';
import * as fs from './fs';

import type { Argv, Config, Template } from 'bongo';
import type { BuildOptions, Format } from 'esbuild';
import type { Args } from './tempura/index';

// TODO: revert to `tempura.Compiler` postfix
type Cache = Map<string, Template.Compiler>;

export const Layouts: Cache = new Map;
export const Partials: Cache = new Map;

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
		format?: Format;
		async?: boolean;
	}
}

export async function collect(argv: Required<Argv>, config: Required<Config>): Promise<void> {
	let opts: BuildOptions = {
		outdir: argv.dest,
		absWorkingDir: argv.cwd,
		publicPath: new URL(config.$site.url).pathname,
		minify: argv.minify,
	};

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
		async style(args) {
			// TODO: figure out output="" for bundle vs
			let { src, output, preload, inline } = args;
			if (!src) throw new Error('Missing "src" argument');

			let input = join(argv.assets, src);
			fs.assert(input, `assets/${src}`);

			let options = { ...opts };

			if (output) {
				delete options.outdir;
				options.splitting = false;
				options.outfile = join(argv.dest, output);
			}

			if (inline) {
				options.write = false;
			} else {
				options.allowOverwrite = options.write = true;
				options.entryNames = options.chunkNames = '[name].[hash]';
				// if (output = 'r.js') options.outfile = join(outdir, output);
			}

			// TODO: errors, warnings
			// TODO: track `result.metafile.inputs[key].imports`
			let result = await esbuild.build(input, options);

			if (inline) {
				// TODO: reference count for de-dupe?
				let html = `<style>${result.outputFiles![0]!.text}</style>`;

				if (result.outputFiles!.length > 1) {
					console.log(
						'[TODO][#style.inline] more than 1 output',
						JSON.stringify(result.outputFiles, null, 2)
					);
				}

				return html;
			}

			// esbuild returns all cwd-relative
			let entry = relative(argv.cwd, input);
			let key, tmp, outfile='';

			for (key in result.metafile!.outputs) {
				tmp = result.metafile!.outputs[key];
				if (tmp.entryPoint === entry) {
					outfile = key;
					break;
				}
			}

			if (!outfile) {
				throw new Error(`Missing output for "${src}" entrypoint`);
			}

			// TODO: check (https?)?// prefix
			outfile = join(argv.cwd, outfile);
			outfile = relative(argv.dest, outfile);
			outfile = config.$utils.url.abs(outfile);

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
			// console.log('INSIDE #SCRIPT block', args);
			let { src, target, format, async, defer, inline } = args;
			if (!src) throw new Error('Missing "src" argument');

			let input = join(argv.assets, src);
			fs.assert(input, `assets/${src}`);

			let options = { ...opts };
			if (target) options.target = target;
			if (format) options.format = format;

			if (inline) {
				options.write = false;
			} else {
				options.allowOverwrite = options.write = true;
				options.entryNames = options.chunkNames = '[name].[hash]';
				// if (output = 'r.js') options.outfile = join(outdir, output);
			}

			// TODO: errors, warnings
			// TODO: track `result.metafile.inputs[key].imports`
			let result = await esbuild.build(input, options);
			// console.log('~> [script] result', JSON.stringify(result, null, 2));

			// esbuild returns all cwd-relative
			let entry = relative(argv.cwd, input);
			let key, tmp, outfile='';

			for (key in result.metafile!.outputs) {
				tmp = result.metafile!.outputs[key];
				if (tmp.entryPoint === entry) {
					outfile = key;
					break;
				}
			}

			if (outfile) {
				outfile = join(argv.cwd, outfile);
				outfile = relative(argv.dest, outfile);
				outfile = config.$utils.url.abs(outfile);
			} else {
				throw new Error(`Missing output for "${src}" entrypoint`);
			}

			// begin construction
			let output = '<script';
			if (async) output += ' async';
			if (!format || format === 'esm') {
				output += ' type=module';
			} else if (defer) {
				output += ' defer';
			}

			if (inline) {
				// TODO: reference count should fix this
				tmp = result.outputFiles![0]!;
				output += '>' + tmp.text + '</script>';

				// all others are chunks, write to disk
				Promise.all(result.outputFiles!.slice(1).map(obj => {
					return fs.write(obj.path, obj.contents);
				})); //.catch(rej);
			} else {
				output += ` src="${outfile}"></script>`;
			}

			return output;

				// 	return res(output);
				// }).catch(rej);
		}
	};

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

export function frontmatter(content: string): [number, Template.Params] {
	let metadata: Template.Params = {};
	if (content.substring(0, 3) !== '---') return [0, metadata];

	let match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(content);
	if (match == null) return [0, metadata];

	match[1].split('\n').forEach(pair => {
		let [key, ...v] = pair.split(':');
		metadata[key.trim()] = v.join(':').trim();
	});

	return [match[0].length, metadata];
}
