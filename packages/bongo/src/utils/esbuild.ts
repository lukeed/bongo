import type { BuildOptions, BuildResult } from 'esbuild';

type Group = `${string}~${string}`;
type Thunk = Promise<BuildResult>;

let INPUTS: Record<Group, Set<string>> = {};
let CONFIGS: Record<Group, BuildOptions> = {};
let BUNDLERS: Record<Group, Thunk> = {};

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

export function toGroup(options: BuildOptions): Group {
	return (options.format || '') + '~' + String(options.target || '') as Group;
}

// TODO: invalidate BUNDLERS for dev server
export function reset() {
	INPUTS = {};
	CONFIGS = {};
	BUNDLERS = {};
}

export function prebuild(input: string, config: BuildOptions): Group {
	let group = toGroup(config);
	let inputs = INPUTS[group] || new Set;
	CONFIGS[group] = CONFIGS[group] || config;
	INPUTS[group] = inputs;
	inputs.add(input);
	return group;
}

// TODO: move warning|error handling here
export function build(group: Group): Thunk {
	esbuild = esbuild || require('esbuild');

	let thunk = BUNDLERS[group];
	if (thunk) return thunk;

	let inputs = INPUTS[group];
	let options = CONFIGS[group];
	if (!inputs || !inputs.size || !options) {
		throw new Error('invalid group');
	}

	options.entryPoints = [...inputs];
	options = { ...defaults, ...options };
	// NOTE: esbuild only supports splitting w/ ESM format
	if (options.format !== 'esm') options.splitting = false;
	// console.log('~> shared:', options.entryPoints);
	return BUNDLERS[group] = esbuild.build(options);
}

// TODO: errors, warnings
// TODO: track `result.metafile.inputs[key].imports`
export function postbuild(entry: string, result: BuildResult): string | never {
	// let msgs: string[] = [];
	// msgs.push(...esbuild.formatMessagesSync(result.errors, { kind: 'error' }));
	// msgs.push(...esbuild.formatMessagesSync(result.warnings, { kind: 'warning' }));

	let key, tmp;
	for (key in result.metafile!.outputs) {
		tmp = result.metafile!.outputs[key];
		if (tmp.entryPoint === entry) return key;
	}
	throw new Error(`Missing output for "${entry}" entrypoint`);
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
