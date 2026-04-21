import { dirname, join, resolve } from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';
import { randomBytes } from 'node:crypto';
import { transform } from './bundler';
import * as fs from './fs';

import type { Config } from 'bongo';

const priority = [
	'bongo.config.ts',
	'bongo.config.mjs',
	'bongo.config.cjs',
	'bongo.config.js',
];

async function bundleConfigToTemp(file: string): Promise<string> {
	let rd = await import('rolldown');

	let tmpdir = os.tmpdir();
	let name = `bongo-config-${randomBytes(6).toString('hex')}.mjs`;
	let outfile = join(tmpdir, name);

	let external = [
		/^node:/,
		...builtinModules.map(m => new RegExp(`^${m}(\\/.*)?$`)),
		// anything from node_modules stays external
		/[\\/]node_modules[\\/]/,
	];

	let bundle = await rd.rolldown({
		input: file,
		external,
		resolve: {
			extensions: ['.ts', '.mjs', '.js', '.cjs', '.json'],
			conditionNames: ['import', 'node'],
			mainFields: ['module', 'main'],
		},
	});

	try {
		await bundle.write({
			file: outfile,
			format: 'esm',
			minify: false,
			sourcemap: false,
		});
	} finally {
		await bundle.close();
	}
	return outfile;
}

type UnknownModule = Record<string, unknown> & { default?: unknown };

function isBun(): boolean {
	return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

function isDeno(): boolean {
	return typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';
}

export async function loadModule(file: string): Promise<UnknownModule> {
	let url = pathToFileURL(file).href;

	if (!/\.ts$/.test(file)) {
		return (await import(url)) as UnknownModule;
	}

	// Bun and Deno strip TS natively
	if (isBun() || isDeno()) {
		return (await import(url)) as UnknownModule;
	}

	// Node path: bundle to temp .mjs, then dynamic import.
	// Temp file has a random name so the import cache is keyed per-call;
	// no `?t=` cache-buster needed (Node ignores query strings on file: URLs).
	let tmp = await bundleConfigToTemp(file);
	try {
		return (await import(pathToFileURL(tmp).href)) as UnknownModule;
	} finally {
		await fs.rm(tmp).catch(() => {});
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
	for (let key in custom.$utils) {
		if (typeof custom.$utils[key] !== 'object') {
			base.$utils[key] = custom.$utils[key];
		} else {
			base.$utils[key] = Object.assign(base.$utils[key], custom.$utils[key]);
		}
	}
}

export async function load(root: string): Promise<Required<Config>> {
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
				return text.split(/\s+/g).length;
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
		plugins: [
			// any user plugins
		]
	};

	let file = await find(root, '.');

	if (file) {
		let user = /\.ts$/.test(file)
			? await transform(file)
			: await fs.load(file);

		// TODO: validate $site keys
		merge(output, user.default || user);
	} else {
		throw new Error('Missing configuration file');
	}

	return output;
}
