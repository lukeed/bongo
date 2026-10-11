import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

describe('copy', () => {
	test('copies without reporting a change to the source, so dev does not rebuild itself', async () => {
		let dir = sandbox();
		let out = sandbox();
		let bytes = Buffer.alloc(200_000, 7);
		writeFileSync(join(dir, 'photo.jpg'), bytes);
		let seen: string[] = [];
		let stop = await fs.watch([dir], file => { seen.push(file); });
		try {
			await new Promise(r => setTimeout(r, 500));
			seen.length = 0;
			await fs.copy(join(dir, 'photo.jpg'), join(out, 'nested/photo.jpg'));
			await new Promise(r => setTimeout(r, 300));
			expect(readFileSync(join(out, 'nested/photo.jpg')).equals(bytes)).toBe(true);
			expect(seen).toEqual([]);
		} finally {
			stop();
		}
	});
});

describe('rmdir', () => {
	test('tolerates another remover deleting the folder first', async () => {
		let root = sandbox();
		for (let i = 0; i < 50; i++) {
			mkdirSync(join(root, `p/${i}`), { recursive: true });
			writeFileSync(join(root, `p/${i}/index.html`), 'x');
		}
		await Promise.all([fs.rmdir(join(root, 'p')), fs.rmdir(join(root, 'p')), fs.rmdir(join(root, 'p'))]);
		expect(existsSync(join(root, 'p'))).toBe(false);
	});
});

describe('prune', () => {
	test('deletes a file and the folders it leaves empty, up to the root', async () => {
		let root = sandbox();
		mkdirSync(join(root, 'a/b/c'), { recursive: true });
		writeFileSync(join(root, 'a/b/c/index.html'), 'x');
		writeFileSync(join(root, 'a/keep.txt'), 'x');
		await fs.prune(join(root, 'a/b/c/index.html'), root);
		expect(existsSync(join(root, 'a/b'))).toBe(false);
		expect(existsSync(join(root, 'a/keep.txt'))).toBe(true);
		await fs.prune(join(root, 'a/keep.txt'), root);
		expect(existsSync(join(root, 'a'))).toBe(false);
		expect(existsSync(root)).toBe(true);
	});
});

describe('watch', () => {
	test('watches only the folder itself when not recursive', async () => {
		let dir = sandbox();
		mkdirSync(join(dir, 'sub'));
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); }, { recursive: false });
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(join(dir, 'sub/deep.css'), 'x');
			writeFileSync(join(dir, 'top.css'), 'x');
			await until(() => seen.has(join(dir, 'top.css')));
			await new Promise(r => setTimeout(r, 150));
			expect(seen.has(join(dir, 'sub/deep.css'))).toBe(false);
		} finally {
			stop();
		}
	});

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
			contents.push(readFileSync(file, 'utf8'));
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
