import { watch as fsw } from 'node:fs';
import { promises as fs } from 'node:fs';
import { existsSync as exists } from 'node:fs';
import { dirname, join, sep } from 'node:path';

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

/**
 * Delete `file`, then each folder above it, up to `root`, that this leaves empty.
 * @example prune('public/old/post/index.html', 'public')
 */
export async function prune(file: string, root: string): Promise<void> {
	await rm(file);
	for (let dir = dirname(file); dir.startsWith(root + sep); dir = dirname(dir)) {
		try {
			await fs.rmdir(dir);
		} catch {
			return;
		}
	}
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

async function setup(dir: string, onChange: Handler, recursive: boolean) {
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
		output[dir] = attach(fsw(dir, { recursive }, onChange.bind(0, dir)));
	} catch (err: any) {
		if (!recursive || err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
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
export type WatchOptions = {
	/** Also watch every folder inside each one. @default true */
	recursive?: boolean;
};

export async function watch(list: string[], callback: Callback, options: WatchOptions = {}): Promise<WatchDisposer> {
	const { recursive = true } = options;
	const dirs = new Set(
		list.filter(exists)
	);

	const Watchers = new Map<string, FSWatcher>();

	// debounced per file and run serially; a change during its own callback queues another pass
	const Timers = new Map<string, NodeJS.Timeout>();
	const Queue = new Set<string>();
	let busy = false;

	async function drain(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			for (let file of Queue) {
				Queue.delete(file);
				await callback(file);
			}
		} finally {
			busy = false;
		}
	}

	// TODO: Catch `EPERM` on Windows for removed dir
	const onChange: Handler = function (dir, _type, filename) {
		if (!filename) return;
		let file = join(dir, filename);
		clearTimeout(Timers.get(file));
		Timers.set(file, setTimeout(() => {
			Timers.delete(file);
			Queue.add(file);
			drain();
		}, 50));
	};

	let dir, output;
	for (dir of dirs) {
		output = await setup(dir, onChange, recursive);
		for (let key in output) {
			Watchers.set(key, output[key]);
		}
	}

	return () => {
		for (let t of Timers.values()) clearTimeout(t);
		Timers.clear();
		Queue.clear();
		for (let w of Watchers.values()) {
			try { w.close(); } catch { /* already closed */ }
		}
		Watchers.clear();
	};
}
