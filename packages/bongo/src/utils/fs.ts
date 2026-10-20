import { createReadStream, createWriteStream, realpathSync, statSync, watch as fsw } from 'node:fs';
import { promises as fs } from 'node:fs';
import { existsSync as exists } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import * as utils from './index';

import type { FSWatcher } from 'node:fs';

export { exists };

export const ls = fs.readdir;
export const read = fs.readFile;
export const stat = fs.stat;

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
 * Throw when `unsafe()` refuses `dir` as the output folder of the project at `root`.
 * @example guard('/site', '/site', []) // throws 'Refusing to empty the output folder "/site": it is the project root'
 */
function guard(dir: string, root: string, keep: string[]): void {
	let reason = unsafe(dir, root, keep);
	if (reason) throw new Error(`Refusing to empty the output folder "${dir}": ${reason}`);
}

/**
 * Delete everything inside `dir`, the output folder, after `unsafe()` allows it. A symlink is deleted, never followed.
 * Another bongo may empty the same folder at the same time.
 * @example await empty('/site/public', '/site', ['/site/content', '/site/assets'])
 */
export async function empty(dir: string, root: string, keep: string[]): Promise<void> {
	guard(dir, root, keep);
	try {
		var names = await fs.readdir(dir);
	} catch (err) {
		if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
		throw err;
	}
	await Promise.all(names.map(name => remove(join(dir, name))));
}

export type Reuse = {
	/** Make room to write `file`, and claim it and its folders, so that `sweep` keeps them. */
	fit(file: string): Promise<void>;
	/** Claim `file`, which stays as it is, and its folders, so that `sweep` keeps them. */
	claim(file: string): void;
	/** Delete each kept file that no `fit` or `claim` claimed, and the folders that this leaves empty. */
	sweep(): Promise<void>;
};

type Kept = { rel: string; dir: boolean; claimed: boolean; gone: boolean };

/**
 * Get ready to write over `dir`, the output folder, after `unsafe()` allows it: delete each symlink in it, never what it points to, and keep the rest.
 * Writing over a file is much faster than making it again. Before each write, `fit` deletes a kept path that no write claimed and that stands in the way:
 * a file where the write needs a folder, a folder where it needs a file, or a path that differs in case only, which a case-insensitive disk would write into.
 * With `made`, the files that the last build left in `dir`, it lists nothing and keeps only those, so a file that something else put there stays.
 * Then each path that a write or the sweep goes through is checked once, and a symlink in it is deleted.
 * @example let old = await reuse('/site/public', '/site', keep); await old.fit(file); await write(file, data); await old.sweep();
 */
export async function reuse(dir: string, root: string, keep: string[], made?: string[]): Promise<Reuse> {
	guard(dir, root, keep);

	let all: Kept[] = [];
	let kept: Map<string, Kept[]> = new Map();
	let exact: Map<string, Kept> = new Map();
	let add = (rel: string, folder: boolean) => {
		let item: Kept = { rel, dir: folder, claimed: false, gone: false };
		all.push(item);
		exact.set(rel, item);
		let key = rel.toLowerCase();
		kept.set(key, [...kept.get(key) ?? [], item]);
	};
	let walk = async (rel: string): Promise<void> => {
		try {
			var entries = await fs.readdir(join(dir, rel), { withFileTypes: true });
		} catch (err) {
			if (!rel && err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
			throw err;
		}
		await utils.settle(entries.map(async entry => {
			let path = rel ? rel + '/' + entry.name : entry.name;
			if (entry.isSymbolicLink()) return remove(join(dir, path));
			add(path, entry.isDirectory());
			if (entry.isDirectory()) await walk(path);
		}));
	};

	if (made) {
		let folders: Set<string> = new Set();
		for (let rel of made) {
			add(rel, false);
			for (let at = rel.lastIndexOf('/'); at > 0; at = rel.lastIndexOf('/', at - 1)) {
				let folder = rel.slice(0, at);
				if (folders.has(folder)) break;
				folders.add(folder);
				add(folder, true);
			}
		}
	} else {
		await walk('');
	}

	let lose = (rel: string) => {
		for (let other of all) {
			if (other.rel === rel || other.rel.startsWith(rel + '/')) other.gone = true;
		}
	};

	// without a walk, a symlink may have come since the last build: delete it, once for each path, before a write or a deletion goes through it
	let checks: Map<string, Promise<boolean>> = new Map();
	let real = (rel: string): Promise<boolean> => {
		let hit = checks.get(rel);
		if (!hit) checks.set(rel, hit = fs.lstat(join(dir, rel)).then(async info => {
			if (!info.isSymbolicLink()) return true;
			lose(rel);
			await remove(join(dir, rel));
			return false;
		}, () => true));
		return hit;
	};

	// a deletion in progress, by the lowercase path; a write to that path waits for it
	let pending: Map<string, Promise<void>> = new Map();

	return {
		async fit(file) {
			let parts = relative(dir, file).split(sep);
			for (let i = 1; i <= parts.length; i++) {
				let rel = parts.slice(0, i).join('/');
				let key = rel.toLowerCase();
				while (pending.has(key)) await pending.get(key);
				if (made) await real(rel);
				for (let item of kept.get(key) ?? []) {
					if (item.gone) continue;
					if (item.rel === rel && item.dir === (i < parts.length)) {
						item.claimed = true;
						continue;
					}
					if (item.claimed) continue;
					lose(item.rel);
					let job = remove(join(dir, item.rel)).finally(() => pending.delete(key));
					pending.set(key, job);
					await job;
				}
			}
		},
		// from the file up, as far as a folder that is claimed already, since each claim claims every folder above it
		claim(file) {
			let rel = file.startsWith(dir + sep) ? file.slice(dir.length + 1) : relative(dir, file);
			if (sep !== '/') rel = rel.split(sep).join('/');
			for (let end = rel.length; end > 0; end = rel.lastIndexOf('/', end - 1)) {
				let item = exact.get(rel.slice(0, end));
				if (!item || item.dir !== (end < rel.length)) continue;
				if (item.claimed) break;
				item.claimed = true;
			}
		},
		async sweep() {
			await utils.settle(all.filter(item => !item.dir && !item.claimed && !item.gone).map(async item => {
				for (let at = item.rel.indexOf('/'); made && at > 0; at = item.rel.indexOf('/', at + 1)) {
					if (!await real(item.rel.slice(0, at))) return;
				}
				if (!item.gone) await prune(join(dir, item.rel), dir);
			}));
		},
	};
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

/**
 * A file that a build looked for and did not find; dev watches `file` to build again when it appears.
 * @example throw new MissingError(`Missing "${rel}" asset!`, file);
 */
export class MissingError extends Error {
	file: string;
	constructor(message: string, file: string) {
		super(message);
		this.file = file;
	}
}

export function assert(path: string, msg = ''): asserts path is string {
	if (!exists(path)) throw new MissingError(msg || `Missing "${path}" file!`, path);
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

	await utils.settle(
		files.map(async dirent => {
			let item = join(dir, dirent.name);
			let rel = join(prefix, dirent.name);
			if (dirent.isDirectory()) {
				return list(item, callback, rel);
			}
			if (dirent.name.startsWith('index.')) {
				index.push([item, rel, dirent.name]);
			} else {
				return callback(item, rel, dirent.name);
			}
		})
	);

	await utils.settle(index.map(async args => callback(...args)));
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
