import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import * as content from './content';

type Sample = { wall: number; user: number; sys: number; rss: number };
type Output = { files: number; bytes: number; sha: string };
type Stage = { name: string; ms: number; rss: number };
type Profile = { stages: Stage[]; rss: number };

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'packages/bongo/bin.js');
const SITES: Record<string, string> = {
	site: join(import.meta.dirname, 'site'),
	docs: join(ROOT, 'docs'),
};

// ru_maxrss is in KiB on Linux, and in bytes on macOS
const RSS_UNIT = process.platform === 'linux' ? 1024 : 1;

let { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		runs: { type: 'string', short: 'r', default: '5' },
		pages: { type: 'string', short: 'p', default: '10000' },
	},
});

let runs = Number(values.runs);
let pages = Number(values.pages);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`Invalid --runs "${values.runs}"; use a whole number above 0`);
if (!Number.isInteger(pages) || pages < 1) throw new Error(`Invalid --pages "${values.pages}"; use a whole number above 0`);

let names = positionals.length ? positionals : Object.keys(SITES);
for (let name of names) {
	if (!SITES[name]) throw new Error(`Unknown "${name}" site; use ${Object.keys(SITES).join(' or ')}`);
}

async function exec(cmd: string[]): Promise<string> {
	let child = Bun.spawn(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
	let [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`"${cmd.join(' ')}" failed:\n${stderr || stdout}`);
	return stdout.trim();
}

async function sample(dir: string): Promise<Sample> {
	let t0 = performance.now();
	let child = Bun.spawn([process.execPath, BIN, 'build', '-C', dir], { stdout: 'ignore', stderr: 'pipe' });
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

async function digest(dir: string): Promise<Output> {
	let entries = await readdir(dir, { recursive: true, withFileTypes: true });
	let files = entries.filter(entry => entry.isFile()).map(entry => relative(dir, join(entry.parentPath, entry.name))).sort();
	let hash = createHash('sha256');
	let bytes = 0;
	for (let file of files) {
		let data = await readFile(join(dir, file));
		bytes += data.length;
		hash.update(`${file}\0${data.length}\0`).update(data);
	}
	return { files: files.length, bytes, sha: hash.digest('hex').slice(0, 16) };
}

// One more build, through stages.ts, while `ps` reads its RSS as often as it can.
async function profile(dir: string): Promise<Profile> {
	let t0 = Date.now();
	let child = Bun.spawn([process.execPath, join(import.meta.dirname, 'stages.ts'), dir], { stdout: 'pipe', stderr: 'pipe' });
	let lines = new Response(child.stdout).text();
	let stderr = new Response(child.stderr).text();
	let samples: [at: number, rss: number][] = [];
	let t1 = 0;
	let exited = child.exited.then(code => (t1 = Date.now(), code));
	while (!t1) {
		let at = Date.now();
		let ps = Bun.spawn(['ps', '-o', 'rss=', '-p', String(child.pid)], { stdout: 'pipe', stderr: 'ignore' });
		let kb = Number((await new Response(ps.stdout).text()).trim());
		if (kb > 0) samples.push([(at + Date.now()) / 2, kb * 1024]);
	}
	let usage = child.resourceUsage();
	if (await exited !== 0 || !usage) throw new Error(`bongo build failed in ${dir}:\n${await stderr}`);

	let stages: Stage[] = [];
	let name = 'boot';
	let from = t0;
	let close = (to: number) => {
		let rss = samples.filter(([at]) => at >= from && at < to).map(([, rss]) => rss);
		stages.push({ name, ms: to - from, rss: Math.max(0, ...rss) });
	};
	for (let line of (await lines).trim().split('\n')) {
		let [at, text] = line.split('\t');
		close(Number(at));
		name = text.startsWith(name + ': ') ? '(other)' : text;
		from = Number(at);
	}
	close(t1);
	return { stages: stages.filter(stage => stage.name !== '(other)' || stage.ms >= 5), rss: usage.maxRSS * RSS_UNIT };
}

function stat(list: number[]): [median: number, min: number, max: number] {
	let sorted = list.toSorted((a, b) => a - b);
	let mid = sorted.length >> 1;
	let median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return [median, sorted[0], sorted[sorted.length - 1]];
}

let time = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
let size = (bytes: number) => bytes ? `${(bytes / 1e6).toFixed(1)} MB` : '—';

let ref = await exec(['git', 'describe', '--always', '--dirty']);
let cpu = cpus();
console.log(`bongo ${ref} · bun ${Bun.version} · ${cpu[0].model} × ${cpu.length} · ${Math.round(totalmem() / 2 ** 30)} GB · ${process.platform} ${release()}`);

console.log('~> building packages');
await exec([process.execPath, 'run', 'build']);

if (names.includes('site')) {
	console.log(`~> writing ${pages} pages`);
	await content.write(SITES.site, pages);
}

for (let name of names) {
	let dir = SITES[name];
	let out = join(dir, 'public');
	console.log(`~> ${name}: 1 warmup + ${runs} runs`);
	await sample(dir);
	let output = await digest(out);

	let samples: Sample[] = [];
	for (let i = 0; i < runs; i++) {
		samples.push(await sample(dir));
		if ((await digest(out)).sha !== output.sha) throw new Error(`${name}: run ${i + 1} wrote other bytes than the warmup run`);
	}

	let { stages, rss } = await profile(dir);
	if ((await digest(out)).sha !== output.sha) throw new Error(`${name}: the profile run wrote other bytes than the warmup run`);

	let rows: [string, string, string][] = [['', 'median', 'min … max']];
	let metrics: [string, keyof Sample, (value: number) => string][] = [['wall', 'wall', time], ['user', 'user', time], ['sys', 'sys', time], ['peak rss', 'rss', size]];
	for (let [label, key, format] of metrics) {
		let [median, min, max] = stat(samples.map(sample => sample[key]));
		rows.push([label, format(median), `${format(min)} … ${format(max)}`]);
	}

	console.log(`\n${relative(ROOT, dir)}/`);
	for (let [label, median, range] of rows) console.log(`  ${label.padEnd(10)}${median.padStart(10)}    ${range}`);
	console.log(`  ${'output'.padEnd(10)}${output.files} files · ${size(output.bytes)} · sha256 ${output.sha}`);

	let width = Math.max(...stages.map(stage => stage.name.length));
	console.log(`\n  ${'stage'.padEnd(width)}${'time'.padStart(10)}${'max rss'.padStart(12)}`);
	for (let stage of stages) console.log(`  ${stage.name.padEnd(width)}${time(stage.ms).padStart(10)}${size(stage.rss).padStart(12)}`);
	console.log(`  ${'peak rss of this run'.padEnd(width)}${''.padStart(10)}${size(rss).padStart(12)}`);
	console.log('');
}
