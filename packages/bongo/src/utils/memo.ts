import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';

import * as fs from './fs';

import type { Argv, Template } from 'bongo';
import type { BundleConfig } from './bundler';
import type { Alternate } from './tags';

/** A registry that a template can read. */
export type Read = 'pages' | 'section' | 'tags';

/** What the last build rendered for one page, to tell if the next build must render it again. */
export type Page = {
	reads: Read[];
	/** Each file that `$assets.load` read, and a hash of it. */
	loads: [file: string, hash: string][];
	placeholders: string[];
	/** The placeholders that the page inlines, whose content is in the page itself. */
	inline: string[];
	/** The images that `$assets.render` made for the page. */
	renders: [name: string, key: string][];
	found: Alternate[];
	/** The size and mtime of the page's file, or its version in memory. */
	stat: [size: number, mtime: number];
};

/** What walk 1 found for one content file; its title and summary come from its params. */
export type Item = {
	hash: string;
	kind: 'page' | 'output' | 'data';
	ext: string;
	params: Template.Params;
	path: string;
	url: string;
	output: string;
	section: string;
	tags: string[];
	headings: Template.Heading[];
	/** A hash of its entry in the registries. */
	record: string;
	page?: Page;
};

/** The state of the last good build, by content file path. */
export type Memo = {
	key: string;
	/** A hash of each registry; `outputs` is of the output files, which `$hooks.transform` gets. */
	registries: { pages: string; tags: string; sections: Record<string, string>; outputs: string };
	/** The bundler registration of each placeholder that a page of the memo has. */
	bundles: Record<string, [entry: string, cfg: BundleConfig]>;
	/** The source files of each placeholder's output in `bongo build`, and their hashes, from the last flush. */
	assets: Record<string, [file: string, hash: string][]>;
	/** What each placeholder put in a page: a hash of the name, exports, and image of its output, and of its content when a page inlines it. */
	marks: Record<string, [link: string, inline: string]>;
	/** A loader rendered an image, which a skipped loader would not register, so every loader runs. */
	loose: boolean;
	items: Record<string, Item>;
	/** Each content file that walk 1 wrote itself, as a loader's non-page result or a copy: its hash, its output, and the output's size and mtime. */
	files: Record<string, [hash: string, output: string, size: number, mtime: number]>;
	/** The size, mtime, and hash of each content file, so a file whose size and mtime did not change is not read; -1 for a file that changed too close to the build to trust its mtime. */
	sources: Record<string, [size: number, mtime: number, hash: string]>;
	/** Each file of the build in `public/`, relative to it, so the next `bongo build` need not list the folder. */
	made: string[];
};

const FORMAT = '6';

// the items of the memo that one write holds
const LINES = 1000;

/**
 * A short hash of `data`, to compare sources and outputs between builds.
 * @example hash('<p>hi</p>') //=> 'C2op…'
 */
export function hash(data: string | Uint8Array): string {
	return createHash('sha1').update(data).digest('base64url');
}

let CODE: string | undefined;

// A hash of this bongo code and the format of its memo, which a memo must match to be read at all.
async function code(): Promise<string> {
	return CODE ??= hash(FORMAT + '\0' + await readFile(realpathSync(__filename), 'utf8'));
}

// The nearest lockfile above `dir`, which pins the version of each plugin and loader.
function lockfile(dir: string): string | undefined {
	for (let at = dir; ; at = dirname(at)) {
		for (let name of ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
			let file = join(at, name);
			if (fs.exists(file)) return file;
		}
		if (at === dirname(at)) return;
	}
}

async function folder(dir: string): Promise<string[]> {
	let files: string[] = [];
	if (fs.exists(dir)) await fs.list(dir, file => void files.push(file));
	return files.sort();
}

/**
 * A hash of everything that can change every page: the bongo code, the runtime, the options of the run,
 * the config and the local files it imports, `data/`, `layouts/`, `partials/`, and the nearest lockfile.
 * @example let key = await memo.key(argv, inputs.files);
 */
export async function key(argv: Required<Argv>, inputs: string[]): Promise<string> {
	let sum = createHash('sha1');
	sum.update(JSON.stringify([await code(), process.versions.bun ?? process.version, argv.minify, argv.dev, argv.dest]));
	let lock = lockfile(argv.cwd);
	let files = [...new Set([...inputs, ...await folder(argv.layouts), ...await folder(argv.partials), ...lock ? [lock] : []])].sort();
	for (let file of files) {
		sum.update(file + '\0');
		if (fs.exists(file)) sum.update(await readFile(file));
		sum.update('\0');
	}
	return sum.digest('hex');
}

// An item is a row, not an object: no key names, a heading's `html` only where it differs from its text, outputs relative to `public/`, and placeholder lists by index in one shared table.
type Heading = [level: number, id: string, text: string, html?: string];
type PageRow = [reads: Read[], loads: [file: string, hash: string][], placeholders: number, inline: string[], renders: [name: string, key: string][], found: Alternate[], stat: [size: number, mtime: number]];
type Row = [rel: string, hash: string, kind: Item['kind'], ext: string, params: Template.Params, path: string, url: string, output: string, section: string, tags: string[], headings: Heading[], record: string, page?: PageRow];

function encode(rel: string, item: Item, dest: string, lists: Map<string, number>): Row {
	let output = item.output.startsWith(dest + sep) ? item.output.slice(dest.length + 1) : item.output;
	let headings = item.headings.map(({ level, id, text, html }): Heading => html === text ? [level, id, text] : [level, id, text, html]);
	let row: Row = [rel, item.hash, item.kind, item.ext, item.params, item.path, item.url, output, item.section, item.tags, headings, item.record];
	let page = item.page;
	if (page) row.push([page.reads, page.loads, lists.get(page.placeholders.join('\n')) ?? -1, page.inline, page.renders, page.found, page.stat]);
	return row;
}

function decode(row: Row, dest: string, lists: string[][]): [string, Item] {
	let [rel, hash, kind, ext, params, path, url, output, section, tags, headings, record, page] = row;
	let item: Item = { hash, kind, ext, params, path, url, output: isAbsolute(output) ? output : dest + sep + output, section, tags, headings: headings.map(([level, id, text, html]) => ({ level, id, text, html: html ?? text })), record };
	if (page) {
		let [reads, loads, index, inline, renders, found, stat] = page;
		item.page = { reads, loads, placeholders: lists[index] ?? [], inline, renders, found, stat };
	}
	return [rel, item];
}

function where(argv: Required<Argv>): string {
	return join(argv.cwd, 'node_modules', '.cache', 'bongo', 'memo.json');
}

/**
 * The memo that the last `bongo build` of this site saved with this bongo, if any: one line for all but its items, then one line for each item.
 * The pages that share a list of placeholders share one array of it.
 * @example let last = await memo.load(argv);
 */
export async function load(argv: Required<Argv>): Promise<Memo | undefined> {
	try {
		let [head, ...lines] = (await readFile(where(argv), 'utf8')).split('\n');
		let { code: from, lists, ...rest } = JSON.parse(head);
		if (from !== await code()) return;
		let memo: Memo = { ...rest, items: {} };
		for (let line of lines) {
			if (!line) continue;
			let [rel, item] = decode(JSON.parse(line), argv.dest, lists);
			memo.items[rel] = item;
		}
		return memo;
	} catch {
		return;
	}
}

/**
 * Delete the saved memo, once `public/` no longer holds the build that it describes.
 * @example await memo.forget(argv);
 */
export async function forget(argv: Required<Argv>): Promise<void> {
	await rm(where(argv), { force: true });
}

/**
 * Save the memo of a good `bongo build` a few items at a time, since it grows with the site and the build is at its largest here.
 * It goes through a temporary file, so a crash never leaves half of it.
 * @example await memo.save(argv, next);
 */
export async function save(argv: Required<Argv>, memo: Memo): Promise<void> {
	let file = where(argv);
	await mkdir(dirname(file), { recursive: true });
	let temp = `${file}.${process.pid}.tmp`;
	let { items, ...head } = memo;
	let entries = Object.entries(items);
	let lists: Map<string, number> = new Map();
	let table: string[][] = [];
	for (let [, item] of entries) {
		let key = item.page?.placeholders.join('\n');
		if (key === undefined || lists.has(key)) continue;
		lists.set(key, table.length);
		table.push(item.page?.placeholders ?? []);
	}
	let handle = await open(temp, 'w');
	try {
		await handle.write(JSON.stringify({ code: await code(), ...head, lists: table }) + '\n');
		for (let i = 0; i < entries.length; i += LINES) {
			await handle.write(entries.slice(i, i + LINES).map(([rel, item]) => JSON.stringify(encode(rel, item, argv.dest, lists)) + '\n').join(''));
		}
	} finally {
		await handle.close();
	}
	await rename(temp, file);
}
