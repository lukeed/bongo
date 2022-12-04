import * as path from 'node:path';
import { existsSync, watch as fsw } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as tempura from 'tempura';

import type { Template } from './types';
import type { WatchListener } from 'node:fs';

export { existsSync as exists };

export const readdir = fs.readdir;

export function bail(msg: unknown): never {
	console.error('ERROR', msg);
	process.exit(1);
}

// `force` => continue if missing
export async function clean(target: string) {
	let abs = path.isAbsolute(target) ? target : path.resolve(target);
	if (existsSync(abs)) fs.rm(abs, { recursive: true });
}

export async function mkdir(input: string) {
	input = path.dirname(input);
	if (existsSync(input)) return;
	await fs.mkdir(input, { recursive: true });
}

export function read(file: string): Promise<string> {
	return fs.readFile(file, 'utf8');
}

export async function write(file: string, data: string | Buffer): Promise<void> {
	await mkdir(file);
	await fs.writeFile(file, data);
}

export async function copy(src: string, target: string): Promise<void> {
	await mkdir(target);
	return fs.cp(src, target, { recursive: true });
}

/** @mutable */
export let blocks: tempura.Blocks = {
	//
}

export function compile(content: string): tempura.Compiler {
	return tempura.compile(content, {
		async: true,
		blocks: blocks,
		props: ['$site', '$page', '$utils'],
	});
}

/**
 * Convert a "*.hbs" file into a Compiler
 */
export async function view(file: string) {
	let html = await read(file);
	return compile(html);
}

export type Caller = (abs: string, rel: string, name: string) => any;

/**
 * Crawl a directory recursively
 * @NOTE Use `list` for "content/**" directories!
 */
export async function ls(dir: string, callback: Caller, prefix=''): Promise<void> {
	let files = await fs.readdir(dir, { withFileTypes: true });

	await Promise.all(
		files.map(dirent => {
			let item = path.join(dir, dirent.name);
			let rel = path.join(prefix, dirent.name);
			return dirent.isDirectory()
				? list(item, callback, rel)
				: callback(item, rel, dirent.name);
		})
	);
}

/**
 * Crawl a "/content/**" directory
 * @NOTE runs callback for "[dir]/index.*" files last
 */
export async function list(dir: string, callback: Caller, prefix=''): Promise<void> {
	// NOTE: build `index.*` files last
	let index: [string, string, string] | undefined;
	let files = await fs.readdir(dir, { withFileTypes: true });

	await Promise.all(
		files.map(dirent => {
			let item = path.join(dir, dirent.name);
			let rel = path.join(prefix, dirent.name);

			if (dirent.isDirectory()) {
				return /^(shortcode|partial)s$/.test(dirent.name) || list(item, callback, rel);
			}

			if (dirent.name.startsWith('index.')) {
				index = [item, rel, dirent.name];
			} else {
				return callback(item, rel, dirent.name);
			}
		})
	);

	if (index) {
		await callback.apply(callback, index);
	}
}

/**
 * simple frontmatter (YAML) parser
 */
export function frontmatter(content: string): {
	offset: number;
	value: Template.Params
} {
	let value: Template.Params = {};

	if (content.substring(0, 3) !== '---') {
		return { offset: 0, value };
	}

	let match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(content);
	if (match == null) 	return { offset: 0, value };

	match[1].split('\n').forEach(pair => {
		let [key, ...v] = pair.split(':');
		value[key.trim()] = v.join(':').trim();
	});

	return { offset: match[0].length, value };
}

/**
 * Recursively watch a directory
 * @note does not work with linux?
 * @see lukeed/watchlist
 */
export function watch(
	input: string,
	callback: WatchListener<string>
) {
	fsw(input, { recursive: true }, callback);
}
