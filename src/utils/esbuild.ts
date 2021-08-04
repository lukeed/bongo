import * as fs from './fs';

import type { BuildResult } from 'esbuild';
import type { BuildOptions } from 'esbuild';

interface AssetCache {
	[absolute: string]: Promise<BuildResult>;
}

let Assets: AssetCache = {};
let defaults: BuildOptions = {
	bundle: true,
	splitting: true,
	// outdir: outdir,
	// entryPoints: [file],
	// absWorkingDir: srcdir,
	target: 'es2017',
	format: 'esm',
	resolveExtensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
	mainFields: ['browser', 'module', 'jsnext', 'main'],
	conditions: ['browser', 'import', 'production'],
	platform: 'neutral',
	incremental: false, // TODO
	sourcemap: false, // TODO
	minify: true, // always, faster
	publicPath: '/', // new URL($site.url).pathname,
	metafile: true,
};

let esbuild: typeof import('esbuild').build;
export function build(input: string, config?: BuildOptions): Promise<BuildResult> {
	esbuild = esbuild || require('esbuild').build;

	// TODO: track references
	// TODO: collect all inputs for build for code splitting reuse
	// if `inline` 2+ count, hoist to external

	let thunk = Assets[input];
	if (thunk) return thunk;

	let options = config
		? { ...defaults, ...config }
		: defaults;

	return Assets[input] = esbuild(options);
}
