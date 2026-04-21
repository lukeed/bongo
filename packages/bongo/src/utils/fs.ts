import { watch as fsw } from 'node:fs';
import { promises as fs } from 'node:fs';
import { existsSync as exists } from 'node:fs';
import { dirname, join } from 'node:path';
import { throttle } from './index';

import type { FSWatcher } from 'node:fs';

export { exists };

// @ts-ignore - Node 14.4
const _rm = fs.rm || fs.rmdir;

export const ls = fs.readdir;
export const read = fs.readFile;

export function rm(file: string): Promise<void> {
	return fs.rm(file, { force: true });
}

export async function rmdir(path: string): Promise<void> {
	!exists(path) || await _rm(path, { recursive: true });
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

type Handler = (dir: string, type: string, filename: string | null) => any;

async function setup(dir: string, onChange: Handler) {
	let output: Record<string, FSWatcher> = {};

	let attach = (watcher: FSWatcher) => {
		watcher.on('error', (err) => {
			// Ignore ENOENT on removed paths — nothing to propagate.
			let e = err as { code?: string };
			if (e.code !== 'ENOENT') throw err;
		});
		return watcher;
	};

	try {
		output[dir] = attach(fsw(dir, { recursive: true }, onChange.bind(0, dir)));
	} catch (err: any) {
		if (err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
			throw err;
		}

		output[dir] = attach(fsw(dir, onChange.bind(0, dir)));
		await list(dir, (rel, abs) => {
			output[abs] = attach(fsw(abs, onChange.bind(0, abs)));
		});
	}

	return output;
}

// @modified lukeed/watchlist
type Callback = (filename: string) => any;
export type WatchDisposer = () => void;
export async function watch(list: string[], callback: Callback): Promise<WatchDisposer> {
	const dirs = new Set(
		list.filter(exists)
	);

	const Triggers = new Set<string>();
	const Watchers = new Map<string, FSWatcher>();

	// TODO: Catch `EPERM` on Windows for removed dir
	const onChange: Handler = throttle(async function (dir, type, filename) {
		if (!filename) return;
		let tmp = join(dir, filename);
		if (Triggers.has(tmp)) return;

		// todo?
		// console.clear();

		Triggers.add(tmp);
		await callback(tmp);
		Triggers.delete(tmp);
	}, 100);

	let dir, output;
	for (dir of dirs) {
		output = await setup(dir, onChange);
		for (let key in output) {
			Watchers.set(key, output[key]);
		}
	}

	return () => {
		for (let w of Watchers.values()) {
			try { w.close(); } catch { /* already closed */ }
		}
		Watchers.clear();
	};
}
