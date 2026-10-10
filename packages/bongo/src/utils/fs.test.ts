import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from './fs';

function sandbox(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), 'bongo-fs-')));
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
	let start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error('timed out');
		await new Promise(r => setTimeout(r, 20));
	}
}

describe('watch', () => {
	test('reports every file when several change at once', async () => {
		let dir = sandbox();
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); });
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(join(dir, 'a.css'), 'a');
			writeFileSync(join(dir, 'b.css'), 'b');
			await until(() => seen.has(join(dir, 'a.css')) && seen.has(join(dir, 'b.css')));
		} finally {
			stop();
		}
	});

	test('re-runs for a file that changes while its callback is still running', async () => {
		let dir = sandbox();
		let file = join(dir, 'a.css');
		let contents: string[] = [];
		let stop = await fs.watch([dir], async changed => {
			if (changed !== file) return;
			contents.push(await Bun.file(file).text());
			await new Promise(r => setTimeout(r, 250));
		});
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(file, 'one');
			await until(() => contents.length === 1);
			writeFileSync(file, 'two');
			await until(() => contents.at(-1) === 'two');
		} finally {
			stop();
		}
	});
});
