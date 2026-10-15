import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { cyan, dim, yellow } from 'kleur/colors';

import { limit } from './index';

// Status line for normal progress output. Callers may pre-color parts of
// `msg` (e.g. wrap success text in green) — this helper only owns the `~>`
// prefix so the `~>` styling stays consistent across commands.
export function info(msg: string): void {
	console.log(`${dim('~>')} ${msg}`);
}

export function debug(...msg: any[]) {
	console.log('[DEBUG]', ...msg);
}

export const error = console.error.bind(console);

export type Watchdog = {
	/** Start the next stage, which ends the current one. */
	step(name: string): void;
	stop(): void;
};

/**
 * Track the stages of a long task. Under `debug` it logs each stage and its time.
 * Always, a stage that is still running is named every `every` ms, so a wait that never ends says what it waits on.
 * @example let watch = log.watchdog({ debug: argv.debug }); watch.step('loading config'); …; watch.stop();
 */
export function watchdog(options: { debug?: boolean; every?: number } = {}): Watchdog {
	let { debug: verbose = false, every = 15_000 } = options;
	let name = '';
	let t0 = Date.now();

	let timer = setInterval(() => {
		if (name) info(`${yellow('still')} ${name} ${dim(`(${elapsed(Date.now() - t0)})`)}`);
	}, every);
	timer.unref?.();

	let end = () => {
		if (verbose && name) debug('[stage]', `${name}: ${elapsed(Date.now() - t0)}`);
	};

	return {
		step(next) {
			end();
			name = next;
			t0 = Date.now();
			if (verbose) debug('[stage]', name);
			timer.refresh();
		},
		stop() {
			end();
			name = '';
			clearInterval(timer);
		},
	};
}

export function elapsed(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spin(label: string): () => void {
	let t0 = Date.now();

	if (!process.stdout.isTTY) {
		return () => {
			process.stdout.write(label + ' ' + dim(`(${elapsed(Date.now() - t0)})`) + '\n');
		};
	}

	let i = 0;
	let write = () => {
		process.stdout.write(`\r${label} ${dim(`(${SPINNER[i++ % SPINNER.length]})`)}\x1b[K`);
	};
	write();
	let timer = setInterval(write, 80);

	return () => {
		clearInterval(timer);
		process.stdout.write(`\r${label} ${dim(`(${elapsed(Date.now() - t0)})`)}\x1b[K\n`);
	};
}

type Size = { num: string; unit: string };

function humanSize(bytes: number): Size {
	if (bytes < 1000) return { num: String(bytes), unit: 'B' };
	if (bytes < 1000_000) return { num: (bytes / 1000).toFixed(2), unit: 'kB' };
	return { num: (bytes / 1000_000).toFixed(2), unit: 'MB' };
}

function fmtSize(s: Size, numW: number, unitW: number): string {
	return s.num.padStart(numW) + ' ' + s.unit.padEnd(unitW);
}

// Up to this many files, the size report lists each one; above it, it groups them by extension, and lists only scripts and stylesheets.
const TABLE_MAX = 50;

// The files that the size report reads and compresses at once.
const GZIPS = 8;

const ASSET = /\.(?:[cm]?js|css)$/i;
const compress = promisify(gzip);

type Row = { name: string; size: Size; gzip?: Size; count?: number };

function files(count: number): string {
	return `${count.toLocaleString('en-US')} ${count === 1 ? 'file' : 'files'}`;
}

/**
 * Print each output file with its size and gzip size. Above 50 files, print the size of each kind of file instead, and list only scripts and stylesheets.
 * Only the files it lists are read, a few at a time, so a large site costs one `stat` for each other file.
 * @example await sizes('/site/public', process.cwd());
 */
export async function sizes(dest: string, cwd: string): Promise<void> {
	let all: { rel: string; bytes: number }[] = [];
	// every folder and file at once: a large site is mostly folders, one for each page
	let walk = async (dir: string, prefix: string): Promise<void> => {
		let entries = await readdir(dir, { withFileTypes: true });
		await Promise.all(entries.map(async entry => {
			let file = join(dir, entry.name);
			if (entry.isDirectory()) return walk(file, prefix + entry.name + '/');
			all.push({ rel: prefix + entry.name, bytes: (await stat(file)).size });
		}));
	};
	await walk(dest, '');
	if (!all.length) return;

	let table = all.length <= TABLE_MAX;
	let listed = all.filter(file => table || ASSET.test(file.rel)).sort((a, b) => a.rel.localeCompare(b.rel));
	let slot = limit(GZIPS);
	let gzips = await Promise.all(listed.map(file => slot(async () => (await compress(await readFile(join(dest, file.rel)))).length)));

	let rows: Row[] = [];
	if (!table) {
		let groups: Map<string, { bytes: number; count: number }> = new Map();
		for (let { rel, bytes } of all) {
			if (ASSET.test(rel)) continue;
			let name = extname(rel) || rel.slice(rel.lastIndexOf('/') + 1);
			let group = groups.get(name) ?? { bytes: 0, count: 0 };
			groups.set(name, { bytes: group.bytes + bytes, count: group.count + 1 });
		}
		let sorted = [...groups].sort(([a, x], [b, y]) => y.bytes - x.bytes || a.localeCompare(b));
		for (let [name, group] of sorted) rows.push({ name, size: humanSize(group.bytes), count: group.count });
	}
	listed.forEach((file, i) => rows.push({ name: file.rel, size: humanSize(file.bytes), gzip: humanSize(gzips[i]) }));

	let maxName = Math.max(...rows.map(row => row.name.length));
	let maxNum = Math.max(...rows.map(row => row.size.num.length));
	let maxUnit = Math.max(...rows.map(row => row.size.unit.length));
	let maxGzNum = Math.max(0, ...rows.map(row => row.gzip?.num.length ?? 0));
	let maxGzUnit = Math.max(0, ...rows.map(row => row.gzip?.unit.length ?? 0));

	let dir = cyan((relative(cwd, dest) || 'public') + '/');
	let total = humanSize(all.reduce((sum, file) => sum + file.bytes, 0));
	console.log('');
	console.log(table ? `  ${dir}` : `  ${dir}  ${dim(`${files(all.length)} · ${total.num} ${total.unit}`)}`);

	for (let row of rows) {
		let size = fmtSize(row.size, maxNum, maxUnit);
		let tail = row.gzip ? `${dim('│')} ${fmtSize(row.gzip, maxGzNum, maxGzUnit)}` : dim(files(row.count ?? 0));
		let padName = ' '.repeat(Math.max(1, maxName - row.name.length + 2));
		console.log(`    ${dim(row.name)}${padName}${size} ${tail}`);
	}

	console.log('');
}
