import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { dim, cyan } from 'kleur/colors';

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

function collect(dir: string, prefix: string, out: { rel: string; size: Size; gzip: Size }[]): void {
	let entries = readdirSync(dir, { withFileTypes: true });
	for (let e of entries) {
		let full = join(dir, e.name);
		let rel = prefix ? prefix + '/' + e.name : e.name;
		if (e.isDirectory()) {
			collect(full, rel, out);
		} else {
			let buf = readFileSync(full);
			out.push({ rel, size: humanSize(buf.length), gzip: humanSize(gzipSync(buf).length) });
		}
	}
}

export function sizes(dest: string, cwd: string): void {
	let files: { rel: string; size: Size; gzip: Size }[] = [];
	collect(dest, '', files);
	if (!files.length) return;

	files.sort((a, b) => a.rel.localeCompare(b.rel));

	let dir = relative(cwd, dest) || 'public';
	let maxName = 0;
	let maxNum = 0;
	let maxUnit = 0;
	let maxGzNum = 0;
	let maxGzUnit = 0;

	for (let f of files) {
		if (f.rel.length > maxName) maxName = f.rel.length;
		if (f.size.num.length > maxNum) maxNum = f.size.num.length;
		if (f.size.unit.length > maxUnit) maxUnit = f.size.unit.length;
		if (f.gzip.num.length > maxGzNum) maxGzNum = f.gzip.num.length;
		if (f.gzip.unit.length > maxGzUnit) maxGzUnit = f.gzip.unit.length;
	}

	console.log('');
	console.log(`  ${cyan(dir + '/')}`);

	for (let f of files) {
		let size = fmtSize(f.size, maxNum, maxUnit);
		let gz = fmtSize(f.gzip, maxGzNum, maxGzUnit);
		let padName = ' '.repeat(Math.max(1, maxName - f.rel.length + 2));
		console.log(`    ${dim(f.rel)}${padName}${size} ${dim('│')} ${gz}`);
	}

	console.log('');
}
