import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import * as data from './data';

async function tree(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
	let dir = join(tmpdir(), `bongo-data-${randomBytes(6).toString('hex')}`, 'data');
	for (let [rel, text] of Object.entries(files)) {
		await mkdir(join(dir, rel, '..'), { recursive: true });
		await writeFile(join(dir, rel), text);
	}
	try {
		await run(dir);
	} finally {
		await rm(join(dir, '..'), { recursive: true, force: true });
	}
}

describe('load', () => {
	test('keys each file by its path without the extension', async () => {
		await tree({
			'site.yaml': 'name: bongo\nlinks:\n  - GitHub',
			'oss/history.json': '[["2015-02", 12]]',
			'oss/arr-filter.mutate.yml': 'stars: 5',
			'deep/a/b.json': '{"c": true}',
		}, async dir => {
			let out = await data.load(dir);
			expect(out.value).toEqual({
				site: { name: 'bongo', links: ['GitHub'] },
				oss: { history: [['2015-02', 12]], 'arr-filter.mutate': { stars: 5 } },
				deep: { a: { b: { c: true } } },
			});
			expect(out.files.toSorted()).toEqual([
				join(dir, 'deep/a/b.json'),
				join(dir, 'oss/arr-filter.mutate.yml'),
				join(dir, 'oss/history.json'),
				join(dir, 'site.yaml'),
			]);
		});
	});

	test('loads the default export of a module', async () => {
		await tree({
			'stats.ts': 'let n: number = 40 + 2;\nexport default { n, at: await Promise.resolve("now") };',
			'list.mjs': 'export default [1, 2];',
		}, async dir => {
			let out = await data.load(dir);
			expect(out.value).toEqual({ stats: { n: 42, at: 'now' }, list: [1, 2] });
		});
	});

	test('a module needs a default export', async () => {
		await tree({ 'x.ts': 'export const a = 1;' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow('data/x.ts: expected a default export');
		});
	});

	test('a missing directory is empty data', async () => {
		let out = await data.load(join(tmpdir(), 'bongo-data-missing', 'data'));
		expect(out).toEqual({ value: {}, files: [] });
	});

	test('skips dotfiles and dot directories', async () => {
		await tree({ '.DS_Store': 'x', '.cache/a.json': '1', 'a.json': '2' }, async dir => {
			expect((await data.load(dir)).value).toEqual({ a: 2 });
		});
	});

	test('names the file of a parse error', async () => {
		await tree({ 'bad.yaml': 'a: 1\na: 2' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow('data/bad.yaml: duplicate key "a" at line 2');
		});
		await tree({ 'bad.json': '{ nope' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow(/^data\/bad\.json: /);
		});
	});

	test('rejects unknown file types', async () => {
		await tree({ 'notes.toml': 'a = 1' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow('data/notes.toml: unsupported data file; use .json, .yaml, .yml, .ts, .mts, .js, .mjs, or .cjs');
		});
	});

	test('rejects two files for one key', async () => {
		await tree({ 'a.json': '1', 'a.yaml': '2' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow('data/a.json and data/a.yaml both define $data.a');
		});
		await tree({ 'oss.json': '{}', 'oss/x.json': '1' }, async dir => {
			await expect(data.load(dir)).rejects.toThrow('data/oss.json and data/oss/x.json both define $data.oss');
		});
	});

	test('dots in a file name do not clash with folders', async () => {
		await tree({ 'a/b.c.json': '1', 'a/b/c.json': '2' }, async dir => {
			expect((await data.load(dir)).value).toEqual({ a: { 'b.c': 1, b: { c: 2 } } });
		});
	});

	test('json and yaml values are read-only', async () => {
		await tree({ 'a.json': '{"list": [{"x": 1}]}' }, async dir => {
			let value = (await data.load(dir)).value as { a: { list: { x: number }[] } };
			expect(Object.isFrozen(value.a)).toBe(true);
			expect(Object.isFrozen(value.a.list)).toBe(true);
			expect(Object.isFrozen(value.a.list[0])).toBe(true);
			expect(() => value.a.list.push({ x: 2 })).toThrow();
		});
	});

	test('__proto__ is an own key, never the prototype', async () => {
		await tree({ '__proto__.json': '{"polluted": true}' }, async dir => {
			let value = (await data.load(dir)).value;
			expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
			expect(Object.keys(value)).toEqual(['__proto__']);
		});
	});
});
