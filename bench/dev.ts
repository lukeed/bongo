import { createServer } from 'node:net';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { apply, EDITS } from './incremental';

import type { Edit } from './incremental';

export type Step = { name: string; ms: number; max: number; after: number; footprint: number; heap: number };

async function port(): Promise<number> {
	let server = createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	let address = server.address();
	await new Promise(resolve => server.close(resolve));
	if (!address || typeof address === 'string') throw new Error('no free port');
	return address.port;
}

function duration(text: string): number {
	return text.endsWith('ms') ? Number(text.slice(0, -2)) : Number(text.slice(0, -1)) * 1000;
}

/**
 * Run `bongo dev` on the site at `dir`, through devrun.ts: the first build, then `rounds` each of layout edits, page edits, and stylesheet edits, then a new page.
 * A layout edit renders every page again; a stylesheet edit renders none, since dev gives assets stable names.
 * Each step gives the time that dev logs for it, the RSS of dev during it and once it settles, and then its footprint and js heap.
 * On macOS, RSS also counts the pages that the allocator has freed until the system takes them back; the footprint, as Activity Monitor shows it, does not.
 * @example let steps = await dev.profile('bench/site', 3);
 */
export async function profile(dir: string, rounds: number): Promise<Step[]> {
	let child = Bun.spawn([process.execPath, join(import.meta.dirname, 'devrun.ts'), dir, String(await port())], { stdout: 'pipe', stderr: 'pipe' });
	let lines: string[] = [];
	let memory = { footprint: 0, heap: 0 };
	let errors = new Response(child.stderr).text();
	let reading = (async () => {
		let rest = '';
		for await (let chunk of child.stdout) {
			let parts = (rest + new TextDecoder().decode(chunk)).split('\n');
			rest = parts.pop() ?? '';
			for (let part of parts) {
				let [mark, footprint, heap] = part.split(' ');
				if (mark === '@mem') memory = { footprint: Number(footprint), heap: Number(heap) };
				else lines.push(stripVTControlCharacters(part));
			}
		}
	})();

	let samples: [at: number, rss: number][] = [];
	let done = false;
	let sampling = (async () => {
		while (!done) {
			let at = Date.now();
			let ps = Bun.spawn(['ps', '-o', 'rss=', '-p', String(child.pid)], { stdout: 'pipe', stderr: 'ignore' });
			let kb = Number((await new Response(ps.stdout).text()).trim());
			if (kb > 0) samples.push([at, kb * 1024]);
		}
	})();

	let seen = 0;
	let until = async (pattern: RegExp): Promise<number> => {
		let start = Date.now();
		for (;;) {
			for (; seen < lines.length; seen++) {
				let found = pattern.exec(lines[seen]);
				if (found) return duration(found[1]);
			}
			if (child.exitCode !== null || Date.now() - start > 120_000) throw new Error(`bongo dev stopped before a line like ${pattern}:\n${lines.join('\n')}`);
			await Bun.sleep(20);
		}
	};
	// events from files written just before dev started can still arrive, so wait for a second with no new line
	let settle = async () => {
		for (let count = -1; count !== lines.length; ) {
			count = lines.length;
			await Bun.sleep(1000);
		}
		seen = lines.length;
	};
	let rebuild = /^\[\d\d:\d\d:\d\d\] .* \((\S+)\)$/;

	let steps: Step[] = [];
	let step = async (name: string, from: number, pattern: RegExp) => {
		let ms = await until(pattern);
		await settle();
		let rss = samples.filter(([at]) => at >= from).map(([, rss]) => rss);
		steps.push({ name, ms, max: Math.max(0, ...rss), after: rss.at(-1) ?? 0, ...memory });
	};

	// each edit to a file undoes the last one, so a layout or stylesheet edit is a real change every round
	let undos: Map<string, () => Promise<void>> = new Map();
	let toggle = async (edit: Edit) => {
		let file = edit.file ?? '';
		let undo = undos.get(file);
		undos.delete(file);
		if (undo) await undo();
		else undos.set(file, await apply(dir, edit));
	};

	try {
		await step('first build', Date.now(), /building \((\S+)\)$/);
		for (let i = 1; i <= rounds; i++) {
			let from = Date.now();
			await toggle(EDITS['layout edit']);
			await step(`layout edit ${i}`, from, rebuild);
		}
		for (let i = 1; i <= rounds; i++) {
			let from = Date.now();
			await toggle({ ...EDITS['body edit'], file: `content/s0/p${i}.md` });
			await step(`page edit ${i}`, from, rebuild);
		}
		for (let i = 1; i <= rounds; i++) {
			let from = Date.now();
			await toggle(EDITS['stylesheet edit']);
			await step(`stylesheet edit ${i}`, from, rebuild);
		}
		let from = Date.now();
		await toggle(EDITS['new page']);
		await step('new page', from, rebuild);
	} catch (err) {
		child.kill();
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`${reason}\n${await errors}`, { cause: err });
	} finally {
		done = true;
		child.kill();
		await Promise.all([child.exited, reading, sampling]);
		for (let undo of undos.values()) await undo();
	}
	return steps;
}
