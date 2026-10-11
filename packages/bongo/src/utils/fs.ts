import { createReadStream, createWriteStream, realpathSync, statSync, watch as fsw } from 'node:fs';
import { promises as fs } from 'node:fs';
import { existsSync as exists } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { FSWatcher } from 'node:fs';

export { exists };

export const ls = fs.readdir;
export const read = fs.readFile;

/**
 * Whether `path` is a file, after symlinks resolve.
 * @example isFile('assets/style.css') //=> true
 */
export function isFile(path: string): boolean {
	return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

export function rm(file: string): Promise<void> {
	return fs.rm(file, { force: true });
}

// The path with every symlink resolved; a part that does not exist yet is kept as written.
function real(path: string): string {
	let rest: string[] = [];
	for (let at = resolve(path); ; at = dirname(at)) {
		try {
			return join(realpathSync(at), ...rest);
		} catch {
			if (at === dirname(at)) return resolve(path);
			rest.unshift(basename(at));
		}
	}
}

function within(child: string, parent: string): boolean {
	return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Why `dir` may not be emptied as the output folder of the project at `root`, or undefined when it may.
 * After symlinks resolve, it must be inside `root`, apart from each folder in `keep`, and away from the home folder.
 * @example unsafe('/site', '/site', ['/site/content']) //=> 'it is the project root'
 */
export function unsafe(dir: string, root: string, keep: string[]): string | undefined {
	let out = real(dir), top = real(root), home = real(homedir());
	if (out === parse(out).root) return 'it is the file system root';
	if (out === home) return 'it is the home folder';
	if (within(home, out)) return 'it holds the home folder';
	if (out === top) return 'it is the project root';
	if (within(top, out)) return 'it holds the project root';
	if (!within(out, top)) return 'it is outside the project';
	for (let path of keep) {
		let source = real(path);
		let name = relative(top, source).split(sep).join('/') + '/';
		if (out === source) return `it is ${name}`;
		if (within(source, out)) return `it holds ${name}`;
		if (within(out, source)) return `it is inside ${name}`;
	}
}

/**
 * Delete everything inside `dir`, the output folder, after `unsafe()` allows it. A symlink is deleted, never followed.
 * Another bongo may empty the same folder at the same time.
 * @example await empty('/site/public', '/site', ['/site/content', '/site/assets'])
 */
export async function empty(dir: string, root: string, keep: string[]): Promise<void> {
	let reason = unsafe(dir, root, keep);
	if (reason) throw new Error(`Refusing to empty the output folder "${dir}": ${reason}`);
	try {
		var names = await fs.readdir(dir);
	} catch (err) {
		if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
		throw err;
	}
	await Promise.all(names.map(name => remove(join(dir, name))));
}

// Another remover working on the same tree can make rm fail (EPERM in Bun); retry until the entry is gone.
async function remove(path: string): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fs.rm(path, { recursive: true, force: true });
		} catch (err) {
			let gone = await fs.lstat(path).then(() => false, () => true);
			if (gone) return;
			if (attempt === 10) throw err;
			await new Promise(r => setTimeout(r, 10 * attempt));
		}
	}
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

// Streams the bytes: Bun's copyFile clones on macOS, which reports a change to the source and made dev rebuild itself.
export async function copy(src: string, dest: string) {
	await mkdir(dest);
	await pipeline(createReadStream(src), createWriteStream(dest));
}

// NOTE: prevents Rollup import() -> require() transform
// @modified lukeed/totalist
export type Caller = (abs: string, rel: string, name: string) => any;
export async function list(dir: string, callback: Caller, prefix='') {
	// NOTE: build `index.*` files last
	let index: [string, string, string][] = [];
	let files = await ls(dir, { withFileTypes: true });

	await Promise.all(
		files.map(dirent => {
			let item = join(dir, dirent.name);
			let rel = join(prefix, dirent.name);
			if (dirent.isDirectory()) {
				return /^(shortcode|partial)s$/.test(dirent.name) || list(item, callback, rel);
			}
			if (dirent.name.startsWith('index.')) {
				index.push([item, rel, dirent.name]);
			} else {
				return callback(item, rel, dirent.name);
			}
		})
	);

	await Promise.all(index.map(args => callback(...args)));
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
