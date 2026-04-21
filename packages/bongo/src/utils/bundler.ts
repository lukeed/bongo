import type { InputOptions, OutputOptions, RolldownOutput } from 'rolldown';

export type Group = `${string}~${string}`;
export type Thunk = Promise<RolldownOutput>;

interface BundleConfig {
	input: InputOptions;
	output: OutputOptions;
}

let INPUTS: Record<Group, Set<string>> = {};
let CONFIGS: Record<Group, BundleConfig> = {};
let BUNDLERS: Record<Group, Thunk> = {};

let rd: typeof import('rolldown');

async function loadRolldown() {
	return rd = rd || await import('rolldown');
}

let inputDefaults: InputOptions = {
	resolve: {
		extensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
		mainFields: ['browser', 'module', 'jsnext', 'main'],
		conditionNames: ['browser', 'import', 'production'],
	},
};

let outputDefaults: OutputOptions = {
	format: 'esm',
	sourcemap: false, // TODO
	minify: true,
	entryFileNames: '[name].[hash].js',
	chunkFileNames: '[name].[hash].js',
	assetFileNames: '[name].[hash][extname]',
};

export function toGroup(config: BundleConfig): Group {
	let format = config.output.format || '';
	let target = '';
	return `${format}~${target}` as Group;
}

// TODO: invalidate BUNDLERS for dev server
export function reset() {
	INPUTS = {};
	CONFIGS = {};
	BUNDLERS = {};
}

export function prebuild(input: string, config: BundleConfig): Group {
	let group = toGroup(config);
	let inputs = INPUTS[group] || new Set;
	CONFIGS[group] = CONFIGS[group] || config;
	INPUTS[group] = inputs;
	inputs.add(input);
	return group;
}

// TODO: move warning|error handling here
export async function build(group: Group): Thunk {
	await loadRolldown();

	let thunk = BUNDLERS[group];
	if (thunk) return thunk;

	let inputs = INPUTS[group];
	let config = CONFIGS[group];

	if (!inputs || !inputs.size || !config) {
		throw new Error('invalid group');
	}

	let entryPoints = [...inputs];
	let input: Record<string, string> = {};
	for (let entry of entryPoints) {
		let name = entry.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
		input[name] = entry;
	}

	let inputOpts: InputOptions = {
		...inputDefaults,
		...config.input,
		input,
		resolve: {
			...inputDefaults.resolve,
			...config.input.resolve,
		},
	};

	let outputOpts: OutputOptions = {
		...outputDefaults,
		...config.output,
	};

	return BUNDLERS[group] = rd.rolldown(inputOpts).then(bundle => bundle.write(outputOpts));
}

// TODO: errors, warnings
export function postbuild(entry: string, result: RolldownOutput): string | never {
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

