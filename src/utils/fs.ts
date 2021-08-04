import * as fs from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync as exists } from 'fs';

export { exists };
export const rmdir = fs.rmdir;
export const read = fs.readFile;
export const ls = fs.readdir;

export function assert(path: string, msg = ''): asserts path is string {
	if (!exists(path)) throw new Error(`Missing "${msg || path}" file!`);
}

export async function write(file: string, data: string|Buffer|Uint8Array) {
	let dir = dirname(file);
	exists(dir) || await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(file, data);
}

export async function copy(src: string, dest: string) {
	let dir = dirname(dest);
	exists(dir) || await fs.mkdir(dir, { recursive: true });
	await fs.copyFile(src, dest);
}

// @modified lukeed/totalist
export type Caller = (abs: string, rel: string, name: string) => any;
export async function list(dir: string, callback: Caller, prefix='') {
	let files = await ls(dir, { withFileTypes: true });

	await Promise.all(
		files.map(dirent => {
			let item = join(dir, dirent.name);
			let rel = join(prefix, dirent.name);
			if (dirent.isFile()) return callback(item, rel, dirent.name);
			return /^(shortcode|partial)s$/.test(dirent.name) || list(item, callback, rel);
		})
	);
}
