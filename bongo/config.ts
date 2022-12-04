import * as path from 'node:path';
import { createRequire } from 'node:module';

import * as esbuild from './esbuild';
import * as utils from './utils';

import type { Config } from './types';

const priority = [
	'bongo.config.ts',
	'bongo.config.mjs',
	'bongo.config.cjs',
	'bongo.config.js',
] as const;

/**
 * Traverse upwards until find a config file
 * @NOTE Does not leave `root` directory
 * @modified lukeed/escalade
 */
export async function find(root: string, start: string): Promise<string|void> {
	let i=0, dir = path.resolve(root, start);
	let files = new Set(await utils.readdir(dir));

	for (; i < priority.length; i++) {
		if (files.has(priority[i])) {
			return path.join(dir, priority[i]);
		}
	}

	dir = path.dirname(dir);

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

let $require: NodeJS.Require;
export async function load(root: string): Promise<Required<Config>> {
	let output: Required<Config> = {
		$site: {
			// @ts-ignore
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
	let user: Config | { default: Config };
	if (!file) throw new Error('Missing configuration file');

	if (/\.ts$/.test(file)) {
		let service = await esbuild.load();

		type Module = NodeJS.Module & {
			_compile?(source: string, filename: string): NodeJS.Module;
		};

		$require ||= createRequire(import.meta.url);
		$require.extensions['.ts'] ||= function (mod: Module, filename: string) {
			let pitch = mod._compile!.bind(mod);

			mod._compile = src => {
				let { code, warnings } = service.transformSync(src, {
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

			$require.extensions['.js'](mod, filename);
		};

		user = $require(file);
	} else {
		user = await import('file:///' + file);
	}

	merge(output, (user as { default: Config }).default || user);

	// ---
	// TODO: validate $site keys
	// ---

	return output;
}
