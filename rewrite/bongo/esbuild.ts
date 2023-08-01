import * as path from 'node:path';
import { reload } from './dev';
import * as ENV from './argv';
import * as $ from './paths';

export type Service = typeof import('esbuild');
export type BuildOptions = import('esbuild').BuildOptions;

let defaults: BuildOptions = {
	bundle: true,
	splitting: true,
	treeShaking: true,

	resolveExtensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
	mainFields: ['browser', 'module', 'jsnext', 'main'],
	conditions: ['browser', 'import', 'production'],
	platform: 'neutral',

	incremental: false, // DEV has value
	sourcemap: false, // DEV has value

	minify: true, // always, faster
	publicPath: '/', // replaced in build

	write: true,
	metafile: true,
	allowOverwrite: true,
	entryNames: '[name].[hash]',
	chunkNames: '[name].[hash]',
};

let esbuild: Service;
export async function load(): Promise<Service> {
	return esbuild ||= await import('esbuild');
}

export async function bundle(input: string, options: BuildOptions): Promise<string> {
	esbuild = await load();

	options.entryPoints = [input];
	options = { ...defaults, ...options };

	// if (inputs.size > 1) {
	// 	options.splitting = true;
	// 	delete options.outfile;
	// } else
	if (options.outfile) {
		options.splitting = false;
		delete options.outdir;
	}

	// NOTE: esbuild only supports splitting w/ ESM format
	if (options.format !== 'esm') options.splitting = false;

	if (ENV.DEV) {
		// drop "[hash]" segment from output file(s)
		options.entryNames = options.chunkNames = '[name]';
		options.sourcemap = 'inline';
		options.watch = {
			onRebuild(error, result) {
				if (error) {
					console.error('[dev] build failure:', error);
				} else {
					for (let k in result!.metafile!.inputs)
						console.log('[dev] "%s" update', k);
					reload();
				}
			}
		};
	}

	let result = await esbuild.build(options);

	let key, tmp;
	input = path.relative($.ROOT, input);
	for (key in result.metafile!.outputs) {
		tmp = result.metafile!.outputs[key];
		if (tmp.entryPoint === input) {
			return path.join($.ROOT, key);
		}
	}

	throw new Error(`Missing output for "${input} entry`);
}
