import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
	/** A hash of the outputs of the page's placeholders, after the flush. */
	signature: string;
	/** The size and mtime of the page's file, or its version in memory. */
	stat: [size: number, mtime: number];
};

/** What walk 1 found for one content file; its title, summary, and tags come from its params. */
export type Item = {
	hash: string;
	kind: 'page' | 'output' | 'data';
	ext: string;
	params: Template.Params;
	path: string;
	url: string;
	output: string;
	section: string;
	headings: Template.Heading[];
	page?: Page;
};

/** The state of the last good build, by content file path. */
export type Memo = {
	key: string;
	registries: { pages: string; tags: string; sections: Record<string, string> };
	/** The bundler registration of each placeholder that a page of the memo has. */
	bundles: Record<string, [entry: string, cfg: BundleConfig]>;
	/** The source files of each placeholder's output in `bongo build`, and their hashes, from the last flush. */
	assets: Record<string, [file: string, hash: string][]>;
	/** A loader rendered an image, which a skipped loader would not register, so every loader runs. */
	loose: boolean;
	items: Record<string, Item>;
	/** Each content file that walk 1 wrote itself, as a loader's non-page result or a copy: its hash, its output, and the output's size and mtime. */
	files: Record<string, [hash: string, output: string, size: number, mtime: number]>;
};

const FORMAT = '2';

// the items of the memo that one write holds
const LINES = 1000;

/**
 * A short hash of `data`, to compare sources and outputs between builds.
 * @example hash('<p>hi</p>') //=> '0b2a…'
 */
export function hash(data: string | Uint8Array): string {
	return createHash('sha1').update(data).digest('hex');
}

let CODE: string | undefined;

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
	CODE ??= hash(await readFile(realpathSync(__filename)));
	let sum = createHash('sha1');
	sum.update(JSON.stringify([FORMAT, CODE, process.versions.bun ?? process.version, argv.minify, argv.dev, argv.dest]));
	let lock = lockfile(argv.cwd);
	let files = [...new Set([...inputs, ...await folder(argv.layouts), ...await folder(argv.partials), ...lock ? [lock] : []])].sort();
	for (let file of files) {
		sum.update(file + '\0');
		if (fs.exists(file)) sum.update(await readFile(file));
		sum.update('\0');
	}
	return sum.digest('hex');
}

function where(argv: Required<Argv>): string {
	return join(argv.cwd, 'node_modules', '.cache', 'bongo', 'memo.json');
}

/**
 * The memo that the last `bongo build` of this site saved, if any: one line for all but its items, then one line for each item.
 * @example let last = await memo.load(argv);
 */
export async function load(argv: Required<Argv>): Promise<Memo | undefined> {
	try {
		let [head, ...lines] = (await readFile(where(argv), 'utf8')).split('\n');
		let memo: Memo = { ...JSON.parse(head), items: {} };
		for (let line of lines) {
			if (!line) continue;
			let [rel, item]: [string, Item] = JSON.parse(line);
			memo.items[rel] = item;
		}
		return memo;
	} catch {
		return;
	}
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
	let handle = await open(temp, 'w');
	try {
		await handle.write(JSON.stringify(head) + '\n');
		let entries = Object.entries(items);
		for (let i = 0; i < entries.length; i += LINES) {
			await handle.write(entries.slice(i, i + LINES).map(entry => JSON.stringify(entry) + '\n').join(''));
		}
	} finally {
		await handle.close();
	}
	await rename(temp, file);
}
