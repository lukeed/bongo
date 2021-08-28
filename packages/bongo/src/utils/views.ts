import * as tempura from './tempura/index';
import { join, relative } from 'path';
import * as esbuild from './esbuild';
import * as fs from './fs';

import type { Argv, Config } from 'bongo';
import type { Args } from './tempura/index';
import type { BuildOptions } from 'esbuild';

type Cache = Map<string, tempura.Compiler>;

export const Partials: Cache = new Map;
export const Layouts: Cache = new Map;

export async function collect(argv: Required<Argv>, config: Required<Config>): Promise<void> {
	let extn = /\.hbs$/i;
	let { layouts } = argv;

	let opts: BuildOptions = {
		outdir: argv.dest,
		absWorkingDir: argv.cwd,
		publicPath: new URL(config.$site.url).pathname,
		minify: argv.minify,
	};

	let blocks: tempura.Blocks = {
		partial(args: Args) {
			// NOTE: partials do not have access to `$page` !!
			let { src, ...rest } = args as Record<string, string>;
			let render = Partials.get(src) || Partials.get(src + '.hbs');

			if (render) return render(rest);
			throw new Error(`Unknown "${src}" partial!`);
		},
		async style(args: Args) {
			return 'TODO';
		},
		async script(args: Args) {
			let { src, target, format, async, defer, inline } = args;

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

	async function compile(file: string) {
		try {
			let content = await fs.read(file, 'utf8');
			return tempura.compile(content, options);
		} catch (err) {
			file = relative(layouts, file);
			let tmp = new Error(`Error compiling "${file}" template!`);
			if (!(err instanceof SyntaxError)) tmp.message += '\n\t'+err.message;
			throw tmp;
		}
	}

	console.log('~> collect "partials" views');
	await fs.list(argv.partials, async (absolute, rel, name) => {
		if (!extn.test(rel)) return;
		let key = name.replace(extn, '');
		let render = await compile(absolute);
		// NOTE: Partials do NOT have access to `$page` var
		blocks[key] = (x: Args) => render({ ...x, ...config }, blocks);
		Partials.set(rel, blocks[key]);
	});

	console.log('~> collect "layouts" views');
	await fs.list(layouts, async (absolute, rel, name) => {
		if (extn.test(name)) Layouts.set(rel, await compile(absolute));
	});
}
