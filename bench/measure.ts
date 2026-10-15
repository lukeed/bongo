import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type Sample = { wall: number; user: number; sys: number; rss: number };
export type Output = { files: number; bytes: number; sha: string };

export const ROOT = join(import.meta.dirname, '..');
export const BIN = join(ROOT, 'packages/bongo/bin.js');

// ru_maxrss is in KiB on Linux, and in bytes on macOS
export const RSS_UNIT = process.platform === 'linux' ? 1024 : 1;

/**
 * Run `bongo build` on the site at `dir` in a new process, and give its time and peak RSS.
 * @example let { wall, rss } = await sample('bench/site', ['--fresh']);
 */
export async function sample(dir: string, args: string[] = []): Promise<Sample> {
	let t0 = performance.now();
	let child = Bun.spawn([process.execPath, BIN, 'build', '-C', dir, ...args], { stdout: 'ignore', stderr: 'pipe' });
	let [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
	let wall = performance.now() - t0;
	let usage = child.resourceUsage();
	if (code !== 0 || !usage) throw new Error(`bongo build failed in ${dir}:\n${stderr}`);
	return {
		wall,
		user: Number(usage.cpuTime.user) / 1e3,
		sys: Number(usage.cpuTime.system) / 1e3,
		rss: usage.maxRSS * RSS_UNIT,
	};
}

async function list(dir: string): Promise<string[]> {
	let entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries.filter(entry => entry.isFile()).map(entry => relative(dir, join(entry.parentPath, entry.name))).sort();
}

/**
 * The number of files in `dir`, their size, and a sha256 of their paths and bytes.
 * @example let { sha } = await digest('bench/site/public');
 */
export async function digest(dir: string): Promise<Output> {
	let files = await list(dir);
	let hash = createHash('sha256');
	let bytes = 0;
	for (let file of files) {
		let data = await readFile(join(dir, file));
		bytes += data.length;
		hash.update(`${file}\0${data.length}\0`).update(data);
	}
	return { files: files.length, bytes, sha: hash.digest('hex').slice(0, 16) };
}

/**
 * The mtime of each file in `dir`, to count the files that a build wrote.
 * @example let before = await mtimes('bench/site/public');
 */
export async function mtimes(dir: string): Promise<Map<string, number>> {
	let files = await list(dir);
	let out: Map<string, number> = new Map();
	for (let file of files) out.set(file, (await stat(join(dir, file))).mtimeMs);
	return out;
}
