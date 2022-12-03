import { relative } from 'node:path';
import { reload } from './dev';
import * as ENV from './argv';
import * as $ from './paths';

export type BuildOptions = import('esbuild').BuildOptions;

let esbuild: typeof import('esbuild');

let defaults: BuildOptions = {
	bundle: true,
	splitting: true,
	// outdir: outdir,
	// entryPoints: [file],
	// absWorkingDir: srcdir,
	resolveExtensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
	mainFields: ['browser', 'module', 'jsnext', 'main'],
	conditions: ['browser', 'import', 'production'],
	platform: 'neutral',
	incremental: false, // TODO
	sourcemap: false, // TODO
	minify: true, // always, faster
	publicPath: '/', // replaced in build
	write: true,
	metafile: true,
	allowOverwrite: true,
	entryNames: '[name].[hash]',
	chunkNames: '[name].[hash]',
};

export async function bundle(input: string, options: BuildOptions): Promise<string> {
	esbuild = esbuild || await import('esbuild');

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
	input = relative($.ROOT, input);
	for (key in result.metafile!.outputs) {
		tmp = result.metafile!.outputs[key];
		if (tmp.entryPoint === input) return key;
	}

	throw new Error(`Missing output for "${input} entry`);
}
