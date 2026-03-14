import type { InlineConfig, Rollup } from 'vite';

export type Group = `${string}~${string}`;
export type Thunk = Promise<Rollup.RollupOutput>;

let INPUTS: Record<Group, Set<string>> = {};
let CONFIGS: Record<Group, InlineConfig> = {};
let BUNDLERS: Record<Group, Thunk> = {};

let vite: typeof import('vite');

async function loadVite() {
	return vite = vite || await import('vite');
}

// rolldown/utils transformSync for config loading
let oxcTransformSync: Function;

let defaults: InlineConfig = {
	configFile: false,
	logLevel: 'silent',
	build: {
		write: true,
		sourcemap: false, // TODO
		minify: true,
		rollupOptions: {
			output: {
				entryFileNames: '[name].[hash].js',
				chunkFileNames: '[name].[hash].js',
				assetFileNames: '[name].[hash][extname]',
			},
		},
	},
	resolve: {
		extensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
		mainFields: ['browser', 'module', 'jsnext', 'main'],
		conditions: ['browser', 'import', 'production'],
	},
};

export function toGroup(options: InlineConfig): Group {
	let fmt = options.build?.rollupOptions?.output;
	let format = (fmt && !Array.isArray(fmt) ? fmt.format : '') || '';
	// target is on build.target in vite
	let target = String(options.build?.target || '');
	return `${format}~${target}` as Group;
}

// TODO: invalidate BUNDLERS for dev server
export function reset() {
	INPUTS = {};
	CONFIGS = {};
	BUNDLERS = {};
}

export function prebuild(input: string, config: InlineConfig): Group {
	let group = toGroup(config);
	let inputs = INPUTS[group] || new Set;
	CONFIGS[group] = CONFIGS[group] || config;
	INPUTS[group] = inputs;
	inputs.add(input);
	return group;
}

function mergeConfig(base: InlineConfig, override: InlineConfig): InlineConfig {
	return {
		...base,
		...override,
		build: {
			...base.build,
			...override.build,
			rollupOptions: {
				...base.build?.rollupOptions,
				...override.build?.rollupOptions,
				output: {
					...(base.build?.rollupOptions?.output as object),
					...(override.build?.rollupOptions?.output as object),
				},
			},
		},
		resolve: {
			...base.resolve,
			...override.resolve,
		},
	};
}

// TODO: move warning|error handling here
export async function build(group: Group): Thunk {
	await loadVite();

	let thunk = BUNDLERS[group];
	if (thunk) return thunk;

	let inputs = INPUTS[group];
	let config = CONFIGS[group];

	if (!inputs || !inputs.size || !config) {
		throw new Error('invalid group');
	}

	let entryPoints = [...inputs];
	let rollupInput: Record<string, string> = {};
	for (let entry of entryPoints) {
		let name = entry.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
		rollupInput[name] = entry;
	}

	let merged = mergeConfig(defaults, config);

	// Build rollupOptions.input
	merged.build!.rollupOptions = merged.build!.rollupOptions || {};
	merged.build!.rollupOptions.input = rollupInput;

	return BUNDLERS[group] = vite.build(merged) as Thunk;
}

// TODO: errors, warnings
export function postbuild(entry: string, result: Rollup.RollupOutput): string | never {
	for (let chunk of result.output) {
		if (chunk.type === 'chunk' && chunk.facadeModuleId === entry) {
			return chunk.fileName;
		}
	}
	// Fallback: match by entry name in the filename
	let name = entry.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
	for (let chunk of result.output) {
		if (chunk.type === 'chunk' && chunk.isEntry && chunk.name === name) {
			return chunk.fileName;
		}
	}
	throw new Error(`Missing output for "${entry}" entrypoint`);
}

export async function transform(filename: string) {
	await loadVite();
	oxcTransformSync = oxcTransformSync || (await import('rolldown/utils')).transformSync;

	require.extensions['.ts'] = require.extensions['.ts'] || function (Module: any, filename: string) {
		const pitch = Module._compile.bind(Module);

		Module._compile = (source: string) => {
			const result = oxcTransformSync(filename, source, {
				lang: 'ts',
				sourcemap: false,
			});

			(result.warnings || []).forEach((msg: any) => {
				console.warn(`\noxc warning in ${filename}:`);
				console.warn(msg.message || msg);
			});

			return pitch(result.code, filename);
		};

		require.extensions['.js']!(Module, filename);
	};

	return require(filename);
}
