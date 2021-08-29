import { promises as fs } from 'fs';
import { existsSync as exists } from 'fs';
import { dirname, join } from 'path';

export { exists };

// @ts-ignore - Node 14.4
const rm = fs.rm || fs.rmdir;

export const ls = fs.readdir;
export const read = fs.readFile;

export async function rmdir(path: string): Promise<void> {
	!exists(path) || await rm(path, { recursive: true });
}

export async function mkdir(input: string) {
	if (exists(input=dirname(input))) return;
	await fs.mkdir(input, { recursive: true });
}

export function assert(path: string, msg = ''): asserts path is string {
	if (!exists(path)) throw new Error(`Missing "${msg || path}" file!`);
}

export async function write(file: string, data: string|Buffer|Uint8Array) {
	await mkdir(file);
	await fs.writeFile(file, data);
}

export async function copy(src: string, dest: string) {
	await mkdir(dest);
	await fs.copyFile(src, dest);
}

// NOTE: prevents Rollup import() -> require() transform
export async function load<T = any>(ident: string, dir = ''): Promise<T> {
	try {
		if (dir) ident = join(dir, ident);
		return await Function('x', 'return import("file:///" + x)')(ident);
	} catch (err) {
		if (err.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err;
		return require(ident);
	}
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
