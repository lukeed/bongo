import { cpus, release, totalmem } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import * as content from './content';
import * as dev from './dev';
import * as incremental from './incremental';
import { digest, ROOT, RSS_UNIT, sample } from './measure';

import type { Sample } from './measure';

type Memory = { rss: number; committed: number; used: number; heap: number };
type Stage = { name: string; ms: number; rss: number; start?: Memory; live?: number };
type Mark = { at: number; text: string; memory: Memory | null };
type Trace = { t0: number; t1: number; marks: Mark[]; samples: [at: number, rss: number][]; rss: number; stderr: string };
type Profile = { stages: Stage[]; rss: number; stderr: string };

const SITES: Record<string, string> = {
	site: join(import.meta.dirname, 'site'),
	docs: join(ROOT, 'docs'),
};

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

// `incremental` runs `bongo build` on the generated site after edits, and `dev` runs `bongo dev` on it
let targets = [...Object.keys(SITES), 'incremental', 'dev'];
let names = positionals.length ? positionals : targets;
for (let name of names) {
	if (!targets.includes(name)) throw new Error(`Unknown "${name}" target; use ${targets.join(', ')}`);
}

async function exec(cmd: string[]): Promise<string> {
	let child = Bun.spawn(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
	let [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`"${cmd.join(' ')}" failed:\n${stderr || stdout}`);
	return stdout.trim();
}

// A build through stages.ts, which reads its memory at each stage line, after a full GC with `gc`; without `gc`, `ps` also reads its RSS as often as it can.
async function trace(dir: string, gc: boolean): Promise<Trace> {
	let t0 = Date.now();
	let child = Bun.spawn([process.execPath, join(import.meta.dirname, 'stages.ts'), dir, ...(gc ? ['--gc'] : [])], { stdout: 'pipe', stderr: 'pipe' });
	let lines = new Response(child.stdout).text();
	let errors = new Response(child.stderr).text();
	let samples: [at: number, rss: number][] = [];
	let t1 = 0;
	let exited = child.exited.then(code => (t1 = Date.now(), code));
	while (!gc && !t1) {
		let at = Date.now();
		let ps = Bun.spawn(['ps', '-o', 'rss=', '-p', String(child.pid)], { stdout: 'pipe', stderr: 'ignore' });
		let kb = Number((await new Response(ps.stdout).text()).trim());
		if (kb > 0) samples.push([(at + Date.now()) / 2, kb * 1024]);
	}
	let code = await exited;
	let usage = child.resourceUsage();
	let stderr = await errors;
	if (code !== 0 || !usage) throw new Error(`bongo build failed in ${dir}:\n${stderr}`);
	let marks = (await lines).trim().split('\n').map(line => {
		let [at, text, memory] = line.split('\t');
		return { at: Number(at), text, memory: JSON.parse(memory) };
	});
	return { t0, t1, marks, samples, rss: usage.maxRSS * RSS_UNIT, stderr };
}

// Time, RSS, and memory at the start of each stage come from a plain run; the live heap comes from a `--gc` run, since its GCs change the rest.
async function profile(dir: string): Promise<Profile> {
	let plain = await trace(dir, false);
	let lives = new Map((await trace(dir, true)).marks.map(mark => [mark.text, mark.memory?.heap]));
	let stages: Stage[] = [];
	let name = 'boot';
	let from = plain.t0;
	let start: Memory | undefined;
	let close = (to: number) => {
		let rss = plain.samples.filter(([at]) => at >= from && at < to).map(([, rss]) => rss);
		stages.push({ name, ms: to - from, rss: Math.max(0, ...rss), start, live: start && lives.get(name) });
	};
	for (let mark of plain.marks) {
		close(mark.at);
		name = mark.text.startsWith(name + ': ') ? '(other)' : mark.text;
		from = mark.at;
		start = mark.memory ?? undefined;
	}
	close(plain.t1);
	return { stages: stages.filter(stage => stage.name !== '(other)' || stage.ms >= 5), rss: plain.rss, stderr: plain.stderr };
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

if (names.some(name => ['site', 'incremental', 'dev'].includes(name))) {
	console.log(`~> writing ${pages} pages`);
	await content.write(SITES.site, pages);
}

for (let name of names.filter(name => SITES[name])) {
	let dir = SITES[name];
	let out = join(dir, 'public');
	console.log(`~> ${name}: 1 warmup + ${runs} runs, all --fresh`);
	await sample(dir, ['--fresh']);
	let output = await digest(out);

	let samples: Sample[] = [];
	for (let i = 0; i < runs; i++) {
		samples.push(await sample(dir, ['--fresh']));
		if ((await digest(out)).sha !== output.sha) throw new Error(`${name}: run ${i + 1} wrote other bytes than the warmup run`);
	}

	let { stages, rss, stderr } = await profile(dir);
	if ((await digest(out)).sha !== output.sha) throw new Error(`${name}: a profile run wrote other bytes than the warmup run`);

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
	let row = (label: string, cells: string[]) => `  ${label.padEnd(width)}${cells.map(cell => cell.padStart(11)).join('')}`;
	console.log('\n' + row('stage', ['time', 'max rss', 'rss', 'committed', 'in use', 'js heap', 'live']));
	for (let { name, ms, rss, start, live } of stages) {
		console.log(row(name, [time(ms), size(rss), size(start?.rss ?? 0), size(start?.committed ?? 0), size(start?.used ?? 0), size(start?.heap ?? 0), size(live ?? 0)]));
	}
	console.log(row('peak rss of this run', ['', size(rss)]));
	console.log('  From "rss" on, each column is read as the stage starts. "committed" and "in use" are of mimalloc. "live" is the js heap after a full GC, in a second run.');
	if (stderr.trim()) console.log(`\n  stderr of the profile run:\n${stderr.trimEnd().replace(/^/gm, '    ')}`);
	console.log('');
}

if (names.includes('incremental')) {
	console.log(`~> incremental: ${runs} runs of each edit, and a --fresh build to check the bytes of the last`);
	let steps = await incremental.profile(SITES.site, runs);
	let width = Math.max(...steps.map(step => step.name.length));
	let row = (label: string, cells: string[]) => `  ${label.padEnd(width)}${cells.map(cell => cell.padStart(11)).join('')}`;
	console.log(`\n${relative(ROOT, SITES.site)}/ · bongo build`);
	console.log(row('step', ['wall', 'user', 'sys', 'peak rss', 'written']));
	for (let { name, samples, written } of steps) {
		let median = (key: keyof Sample) => stat(samples.map(sample => sample[key]))[0];
		console.log(row(name, [time(median('wall')), time(median('user')), time(median('sys')), size(median('rss')), String(written)]));
	}
	console.log('  Each value is the median of the runs. "written" counts the files whose mtime is after the build started.');
	console.log('');
}

if (names.includes('dev')) {
	console.log('~> dev: first build, 3 each of layout, page, and stylesheet edits, 1 new page');
	let steps = await dev.profile(SITES.site, 3);
	let width = Math.max(...steps.map(step => step.name.length));
	let row = (label: string, cells: string[]) => `  ${label.padEnd(width)}${cells.map(cell => cell.padStart(11)).join('')}`;
	console.log(`\n${relative(ROOT, SITES.site)}/ · bongo dev`);
	console.log(row('step', ['time', 'max rss', 'rss after', 'footprint', 'js heap']));
	for (let step of steps) console.log(row(step.name, [time(step.ms), size(step.max), size(step.after), size(step.footprint), size(step.heap)]));
	console.log('  "footprint" and "js heap" are read once each step settles. On macOS, RSS also counts memory that the allocator freed, until the system takes it back.');
	console.log('');
}
