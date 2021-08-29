import { dirname, join, resolve } from 'path';
import { transform } from './esbuild';
import * as fs from './fs';

import type { Config } from 'bongo';

const priority = [
	'bongo.config.ts',
	'bongo.config.mjs',
	'bongo.config.cjs',
	'bongo.config.js',
];

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
export function merge(base: Required<Config>, custom: Config) {
	Object.assign(base.$site, custom.$site);
	if (custom.$assets) Object.assign(base.$assets, custom.$assets);
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
		}
	};

	let file = await find(root, '.');

	if (file) {
		let user = /\.ts$/.test(file)
			? await transform(file)
			: await fs.load(file)

		// TODO: validate $site keys
		merge(output, user.default || user);
	} else {
		throw new Error('Missing configuration file');
	}

	return output;
}
