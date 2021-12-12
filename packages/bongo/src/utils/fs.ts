import { watch as fsw } from 'fs';
import { promises as fs } from 'fs';
import { existsSync as exists } from 'fs';
import { dirname, join } from 'path';

import type { FSWatcher, WatchListener } from 'fs';

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
		if ((err as any).code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err;
		return require(ident);
	}
}

// @modified lukeed/totalist
export type Caller = (abs: string, rel: string, name: string) => any;
export async function list(dir: string, callback: Caller, prefix='') {
	// NOTE: build `index.*` files last
	let index: [string, string, string] | void;
	let files = await ls(dir, { withFileTypes: true });

	await Promise.all(
		files.map(dirent => {
			let item = join(dir, dirent.name);
			let rel = join(prefix, dirent.name);
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

	if (index!) {
		await callback.apply(callback, index);
	}
}

async function setup(dir: string, onChange: WatchListener) {
	let output: Record<string, FSWatcher> = {};

	try {
		output[dir] = fsw(dir, { recursive: true }, onChange.bind(0, dir));
	} catch (err) {
		if (err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err;
		output[dir] = fsw(dir, onChange.bind(0, dir));
		await list(dir, (rel, abs) => {
			output[abs] = fsw(abs, onChange.bind(0, abs));
		});
	}

	return output;
}

// @modified lukeed/watchlist
export async function watch(list: string[], callback: Function) {
	const dirs = new Set(list.filter(exists));

	let wip = 0;
	const Triggers = new Set;
	const Watchers = new Map;

	async function handle(): Promise<void> {
		await callback();
		if (--wip) return handle();
	}

	// TODO: Catch `EPERM` on Windows for removed dir
	async function onChange(dir: string, filename: string) {
		let tmp = join(dir, filename);
		if (Triggers.has(tmp)) return;
		if (wip++) return wip = 1;

		// todo?
		console.clear();

		Triggers.add(tmp);
		await handle();
		Triggers.delete(tmp);
	}

	let dir, output, key;
	for (dir of dirs) {
		output = await setup(dir, onChange);
		for (key in output) Watchers.set(key, output[key]);
	}
}
