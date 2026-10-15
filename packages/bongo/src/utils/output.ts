import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as fs from './fs';
import * as minify from './minify';

import type { Argv } from 'bongo';

/** A file in a memory sink: its bytes, the source file it copies, read when it is served, or a maker that runs on the first read. */
export type Entry = { data: Buffer; version: number } | { file: string } | { make(): Promise<Buffer> };

/**
 * Where a build puts its files. Every path is absolute and inside `dir`.
 * @example await sink.write(join(sink.dir, 'index.html'), html)
 */
export type Sink = {
	dir: string;
	write(file: string, data: string | Uint8Array): Promise<void>;
	copy(source: string, file: string): Promise<void>;
	/** Write what `make` gives; a memory sink calls it on the first read of the file. */
	defer(file: string, make: () => Promise<Uint8Array | string>): Promise<void>;
	read(file: string): Promise<Buffer>;
	remove(file: string): Promise<void>;
	clear(): Promise<void>;
	/** Keep the files of the last build, to write over them; refuses where `clear` refuses. A sink that gains nothing from it empties itself instead. */
	reuse(): Promise<void>;
	/** After `reuse`, delete each kept file that no write since then replaced. */
	sweep(): Promise<void>;
	minify(files: string[]): Promise<boolean>;
};

export type Memory = Sink & {
	/** The URL path the site lives under, from `$site.url`, such as `/blog/`. */
	base: string;
	get(file: string): Entry | undefined;
};

let DISKS: Map<string, Sink> = new Map();

/**
 * A plain folder, for code that writes outside a build, like a test; it never empties itself.
 * @example let sink = output.folder('/tmp/out')
 */
export function folder(dir: string): Sink {
	return {
		dir,
		write: fs.write,
		copy: fs.copy,
		defer: async (file, make) => fs.write(file, await make()),
		read: file => fs.read(file),
		remove: file => fs.prune(file, dir),
		clear: () => Promise.reject(new Error(`Refusing to empty "${dir}": it is not an output folder`)),
		reuse: () => Promise.reject(new Error(`Refusing to empty "${dir}": it is not an output folder`)),
		sweep: async () => {},
		minify: minify.html,
	};
}

/**
 * The output folder on disk, as `bongo build` writes it; one sink for each folder.
 * @example let sink = output.disk(argv); await sink.write(join(argv.dest, 'index.html'), html)
 */
export function disk(argv: Required<Argv>): Sink {
	let hit = DISKS.get(argv.dest);
	if (hit) return hit;
	let keep = [argv.assets, argv.content, argv.data, argv.layouts, argv.partials];
	let old: fs.Reuse | undefined;
	let sink: Sink = {
		...folder(argv.dest),
		async write(file, data) {
			await old?.fit(file);
			await fs.write(file, data);
		},
		async copy(source, file) {
			await old?.fit(file);
			await fs.copy(source, file);
		},
		async defer(file, make) {
			let data = await make();
			await old?.fit(file);
			await fs.write(file, data);
		},
		clear() {
			old = undefined;
			return fs.empty(argv.dest, argv.cwd, keep);
		},
		async reuse() {
			old = undefined;
			old = await fs.reuse(argv.dest, argv.cwd, keep);
		},
		async sweep() {
			let done = old;
			old = undefined;
			await done?.sweep();
		},
	};
	DISKS.set(argv.dest, sink);
	return sink;
}

/**
 * Output that `bongo dev` keeps in memory and serves; with `mirror`, every change also goes to that disk sink.
 * @example let sink = output.memory(argv.dest); let entry = sink.get(join(argv.dest, 'index.html'))
 */
export function memory(dir: string, mirror?: Sink): Memory {
	let files: Map<string, Entry> = new Map();
	let version = 0;

	let sink: Memory = {
		dir,
		base: '/',
		get: file => files.get(file),
		async write(file, data) {
			files.set(file, { data: Buffer.from(data), version: ++version });
			await mirror?.write(file, data);
		},
		async copy(source, file) {
			files.set(file, { file: source });
			await mirror?.copy(source, file);
		},
		async defer(file, make) {
			let made: Promise<Buffer> | undefined;
			let entry: Entry = {
				make: () => made ??= make().then(bytes => {
					let data = Buffer.from(bytes);
					if (files.get(file) === entry) files.set(file, { data, version: ++version });
					return data;
				}, err => {
					made = undefined;
					throw err;
				}),
			};
			files.set(file, entry);
			await mirror?.defer(file, entry.make);
		},
		async read(file) {
			let entry = files.get(file);
			if (!entry) throw new Error(`No "${file}" in the dev output`);
			if ('make' in entry) return entry.make();
			return 'data' in entry ? entry.data : fs.read(entry.file);
		},
		async remove(file) {
			files.delete(file);
			await mirror?.remove(file);
		},
		async clear() {
			files.clear();
			await mirror?.clear();
		},
		reuse: () => sink.clear(),
		sweep: async () => {},
		async minify(list) {
			let temp = await mkdtemp(join(tmpdir(), 'bongo-minify-'));
			try {
				let copies = await Promise.all(list.map(async (file, i) => {
					let copy = join(temp, `${i}.html`);
					await writeFile(copy, await sink.read(file));
					return copy;
				}));
				if (!await minify.html(copies)) return false;
				await Promise.all(list.map(async (file, i) => sink.write(file, await readFile(copies[i]))));
				return true;
			} finally {
				await rm(temp, { recursive: true, force: true });
			}
		},
	};
	return sink;
}
