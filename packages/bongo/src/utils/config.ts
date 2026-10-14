import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { summary, toBuildError } from './bundler';
import * as fs from './fs';

import type { Config } from 'bongo';
import type { Plugin, RolldownBuild } from 'rolldown';
import type { BuildError } from './bundler';

const priority = [
	'bongo.config.ts',
	'bongo.config.mjs',
	'bongo.config.cjs',
	'bongo.config.js',
];

// Packages and builtins, which the runtime resolves; `#imports` and paths are bundled.
const BARE = /^(?![./#\0]|[a-zA-Z]:[\\/]|file:)/;

// Module-relative values keep pointing at each source file, not at the bundled copy.
const META: Record<string, string> = {
	'import.meta.url': '__bongo_url',
	'import.meta.filename': '__bongo_filename',
	'import.meta.dirname': '__bongo_dirname',
	'import.meta.path': '__bongo_filename',
	'import.meta.dir': '__bongo_dirname',
	__filename: '__bongo_filename',
	__dirname: '__bongo_dirname',
};

const meta: Plugin = {
	name: 'bongo:meta',
	transform(code, id) {
		if (!/\.[cm]?[jt]sx?$/.test(id) || !/import\.meta|__dirname|__filename/.test(code)) return null;
		let values = `const __bongo_url = ${JSON.stringify(pathToFileURL(id).href)}, __bongo_filename = ${JSON.stringify(id)}, __bongo_dirname = ${JSON.stringify(dirname(id))};`;
		// prepended on the same line, so line numbers in errors stay true
		return { code: values + code };
	},
};

// Next to the nearest node_modules, bare imports resolve as they do from the source file.
function scratch(file: string): string {
	for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
		let modules = join(dir, 'node_modules');
		if (fs.exists(modules)) return join(modules, '.bongo');
	}
	return tmpdir();
}

// Every file the bundle loaded, including modules that tree-shaking dropped from its output.
async function read(bundle: RolldownBuild, file: string): Promise<string[]> {
	return [...new Set([file, ...(await bundle.watchFiles).filter(id => !id.startsWith('\0'))])];
}

export type Module = {
	exports: Record<string, unknown>;
	/** The local files the module read, itself included. */
	files: string[];
};

/**
 * A module that failed to bundle or to run.
 * `error` locates the failure and `files` lists the local files read so far, to watch for a fix.
 */
export class LoadError extends Error {
	error: BuildError;
	files: string[];

	constructor(error: BuildError, files: string[], root: string, cause: unknown) {
		super(summary(error, root), { cause });
		this.name = 'LoadError';
		this.error = error;
		this.files = files;
	}
}

/**
 * Import `file` as fresh code: Rolldown bundles it and its local imports into one temporary module,
 * which is imported once and deleted. Packages stay external and resolve as usual.
 * Errors name places relative to `root`.
 * @example let { exports, files } = await loadModule('/site/bongo.config.ts');
 */
export async function loadModule(file: string, root = dirname(file)): Promise<Module> {
	let rd = await import('rolldown');
	let bundle = await rd.rolldown({
		input: file,
		platform: 'node',
		external: id => BARE.test(id),
		transform: { define: META },
		plugins: [meta],
	});

	try {
		var { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
		var files = await read(bundle, file);
	} catch (err) {
		throw new LoadError(toBuildError(err, file), await read(bundle, file), root, err);
	} finally {
		await bundle.close();
	}

	let [chunk] = output;
	let base = scratch(file);

	// a new folder each time: Bun cannot import a file added to a folder it has already read
	await mkdir(base, { recursive: true });
	let dir = await mkdtemp(join(base, `${basename(file)}-`));

	try {
		let temp = join(dir, 'module.mjs');
		await writeFile(temp, chunk.code);
		let exports: Record<string, unknown> = await import(pathToFileURL(temp).href);
		return { exports, files };
	} catch (err) {
		let message = err instanceof Error ? err.message : String(err);
		throw new LoadError({ message, file }, files, root, err);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Traverse upwards until find a config file
 * @NOTE Does not leave `root` directory
 * @modified lukeed/escalade
 */
export async function find(root: string, start: string): Promise<string|void> {
	let i=0, dir = resolve(root, start);
	let files = new Set(await fs.ls(dir));

	for (; i < priority.length; i++) {
		if (files.has(priority[i])) {
			return join(dir, priority[i]);
		}
	}

	dir = dirname(dir);

	if (dir.startsWith(root)) {
		return find(root, dir);
	}
}

/**
 * Merge config objects
 * Overrides default values
 * Priority: rules > plugins
 * @NOTE Mutates `base` object!
 */
export function merge(base: Required<Config>, custom: Partial<Config>) {
	if (custom.plugins) {
		custom.plugins.forEach(o => merge(base, o));
	}
	Object.assign(base.$site, custom.$site);
	Object.assign(base.$assets, custom.$assets);
	Object.assign(base.$partials, custom.$partials);
	if (custom.$build) {
		Object.assign(base.$build, custom.$build);
	}
	if (custom.$images) {
		Object.assign(base.$images, custom.$images);
	}
	let next = custom.$hooks?.transform;
	if (next) {
		let prev = base.$hooks.transform;
		base.$hooks.transform = prev ? async (text, ctx) => next(await prev(text, ctx), ctx) : next;
	}
	for (let key in custom.$utils) {
		if (typeof custom.$utils[key] !== 'object') {
			base.$utils[key] = custom.$utils[key];
		} else {
			base.$utils[key] = Object.assign(base.$utils[key] || {}, custom.$utils[key]);
		}
	}
}

export type Loaded = {
	config: Required<Config>;
	/** The config file and the local files it imports. */
	files: string[];
};

/**
 * Find and load the config above `root`, merged over bongo's defaults.
 * @example let { config, files } = await load('/site');
 */
export async function load(root: string): Promise<Loaded> {
	let output: Required<Config> = {
		$site: {
			url: '',
			lang: '',
			title: '',
			description: '',
			menu: {},
		},
		$utils: {
			// todo: move all to import
			truncate(text: string, length: number): string {
				return (text || '').substring(0, length);
			},
			countwords(text: string): number {
				let words = (text || '').trim();
				return words ? words.split(/\s+/g).length : 0;
			},
			url: {
				abs(to: string, fro?: string): string {
					return new URL(to, fro || output.$site.url).pathname;
				}
			},
			date: {
				format(value: string|number|Date, format: string): string {
					let d = new Date(value);
					return d.toISOString();
				}
			}
		},
		$assets: {
			// loaders
		},
		$partials: {
			// custom partials
		},
		$build: {},
		$images: {},
		$hooks: {},
		plugins: [
			// any user plugins
		]
	};

	let file = await find(root, '.');
	if (!file) throw new Error('Missing configuration file');

	let user = await loadModule(file, root);

	// TODO: validate $site keys
	merge(output, (user.exports.default as Partial<Config>) || (user.exports as Partial<Config>));

	return { config: output, files: user.files };
}
