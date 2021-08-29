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

let esbuild: typeof import('esbuild');
export function build(input: string, config?: BuildOptions): Promise<BuildResult> {
	esbuild = esbuild || require('esbuild');

	// TODO: track references
	// TODO: collect all inputs for build for code splitting reuse
	// if `inline` 2+ count, hoist to external

	let thunk = Assets[input];
	if (thunk) return thunk;

	return Assets[input] = esbuild.build({
		...defaults, ...config,
		entryPoints: [input],
	});
}

export async function transform(filename: string) {
	esbuild = esbuild || require('esbuild');

	require.extensions['.ts'] = require.extensions['.ts'] || function (Module, filename) {
		// @ts-ignore – internal method
		const pitch = Module._compile.bind(Module);

		// @ts-ignore - internal method
		Module._compile = (source: string) => {
			const { code, warnings } = esbuild.transformSync(source, {
				minify: true,
				format: 'cjs',
				sourcemap: 'inline',
				sourcefile: filename,
				loader: 'ts',
			});

			warnings.forEach(msg => {
				console.warn(`\nesbuild warning in ${filename}:`);
				console.warn(msg.location);
				console.warn(msg.text);
			});

			return pitch(code, filename);
		};

		require.extensions['.js'](Module, filename);
	};

	return require(filename);
}
