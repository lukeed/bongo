import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import * as bundler from './bundler';

async function tmp(files: Record<string, string>): Promise<{ dir: string; outDir: string }> {
	let dir = join(tmpdir(), `bongo-bundler-test-${randomBytes(6).toString('hex')}`);
	let outDir = join(dir, '__out');
	await mkdir(outDir, { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let p = join(dir, name);
			await mkdir(join(p, '..'), { recursive: true });
			await writeFile(p, contents);
		}),
	);
	return { dir, outDir };
}

afterEach(() => {
	bundler.reset();
});

describe('register', () => {
	test('returns a placeholder with the expected shape', () => {
		let p = bundler.register('/a/b.ts', { kind: 'js' });
		expect(p).toMatch(/^__BONGO_BUNDLE:[a-f0-9]{16}__$/);
	});

	test('is idempotent for the same (entry, cfg)', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		let b = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		expect(a).toBe(b);
	});

	test('different entries produce different placeholders', () => {
		let a = bundler.register('/x.ts', { kind: 'js' });
		let b = bundler.register('/y.ts', { kind: 'js' });
		expect(a).not.toBe(b);
	});

	test('different configs for the same entry produce different placeholders', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		let b = bundler.register('/x.ts', { kind: 'js', format: 'cjs' });
		expect(a).not.toBe(b);
	});

	test('placeholder is stable across calls in different insertion orders', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm', minify: true });
		bundler.reset();
		let b = bundler.register('/x.ts', { kind: 'js', minify: true, format: 'esm' });
		expect(a).toBe(b);
	});
});

describe('flush() — JS', () => {
	test('bundles a single JS entry and resolves to a hashed filename', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x: number = 1;\nconsole.log(x);' });
		try {
			let p = bundler.register(join(dir, 'entry.ts'), { kind: 'js', format: 'esm' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p);
			expect(info).toBeDefined();
			// rolldown uses base62 hashes (e.g. "jxy3YN54"), not hex-only
		expect(info!.filename).toMatch(/^entry\.[a-zA-Z0-9]+\.js$/);
			let written = await readFile(join(outDir, info!.filename), 'utf8');
			expect(written).toContain('console.log');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('batches same-config JS entries into one rolldown run', async () => {
		let { dir, outDir } = await tmp({
			'a.ts': 'export const a = 1;',
			'b.ts': 'export const b = 2;',
		});
		try {
			let pa = bundler.register(join(dir, 'a.ts'), { kind: 'js', format: 'esm' });
			let pb = bundler.register(join(dir, 'b.ts'), { kind: 'js', format: 'esm' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			expect(result.outputs.size).toBe(2);
			expect(result.outputs.get(pa)!.filename).toMatch(/^a\.[a-zA-Z0-9]+\.js$/);
			expect(result.outputs.get(pb)!.filename).toMatch(/^b\.[a-zA-Z0-9]+\.js$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('reports an error for a non-existent entry (no throw)', async () => {
		let { outDir } = await tmp({ 'unused.ts': '' });
		try {
			bundler.register('/definitely/not/here.ts', { kind: 'js' });
			let result = await bundler.flush({ outDir });
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.outputs.size).toBe(0);
		} finally {
			await rm(outDir, { recursive: true, force: true });
		}
	});
});

describe('flush() — CSS', () => {
	test('emits a hashed CSS file and reports dependencies', async () => {
		let { dir, outDir } = await tmp({
			'style.css': '@import "shared.css";\n.a { color: red; }',
			'shared.css': '.b { color: blue; }',
		});
		try {
			let p = bundler.register(join(dir, 'style.css'), { kind: 'css', minify: true });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p);
			expect(info).toBeDefined();
			expect(info!.filename).toMatch(/^style\.[a-f0-9]+\.css$/);
			let written = await readFile(join(outDir, info!.filename), 'utf8');
			expect(written).toContain('.a');
			expect(written).toContain('.b');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('auto-enables CSS modules for *.module.css', async () => {
		let { dir, outDir } = await tmp({
			'button.module.css': '.red { color: red; }',
		});
		try {
			let p = bundler.register(join(dir, 'button.module.css'), { kind: 'css' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p)!;
			expect(info.exports).toBeDefined();
			expect(info.exports!.red).toMatch(/.+/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('resolve()', () => {
	test('returns the filename for a placeholder from the last flush', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x = 1;' });
		try {
			let p = bundler.register(join(dir, 'entry.ts'), { kind: 'js' });
			await bundler.flush({ outDir });
			let file = bundler.resolve(p);
			// rolldown uses base62 hashes (e.g. "jxy3YN54"), not hex-only
			expect(file).toMatch(/^entry\.[a-zA-Z0-9]+\.js$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('throws for a placeholder that was not in the last flush', () => {
		expect(() => bundler.resolve('__BONGO_BUNDLE:ffffffffffffffff__' as never)).toThrow();
	});
});

describe('reset()', () => {
	test('clears registrations and outputs', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x = 1;' });
		try {
			let p = bundler.register(join(dir, 'entry.ts'), { kind: 'js' });
			await bundler.flush({ outDir });
			bundler.reset();
			expect(() => bundler.resolve(p)).toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
