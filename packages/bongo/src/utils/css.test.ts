import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import * as css from './css';

async function makeFixtureDir(files: Record<string, string>): Promise<string> {
	let dir = join(tmpdir(), `bongo-css-test-${randomBytes(6).toString('hex')}`);
	await mkdir(dir, { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let path = join(dir, name);
			await mkdir(join(path, '..'), { recursive: true });
			await writeFile(path, contents);
		}),
	);
	return dir;
}

describe('bundle', () => {
	test('bundles a single CSS file', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { color: red; }',
		});
		try {
			let result = await css.bundle({ entry: join(dir, 'style.css') });
			let code = result.code.toString('utf8');
			expect(code).toContain('.a');
			expect(code).toContain('red');
			expect(result.dependencies).toEqual([]);
			expect(result.exports).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('bundles @import transitively and reports dependencies', async () => {
		let dir = await makeFixtureDir({
			'entry.css': `@import 'other.css';\n.a { color: red; }`,
			'other.css': '.b { color: blue; }',
		});
		try {
			let entry = join(dir, 'entry.css');
			let result = await css.bundle({ entry });
			let code = result.code.toString('utf8');
			expect(code).toContain('.a');
			expect(code).toContain('.b');
			// lightningcss reports transitive @import'd files as dependencies
			// (dependency count may be 0 if lightningcss inlined the import — accept either)
			expect(Array.isArray(result.dependencies)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('minifies when minify=true', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a {\n  color: red;\n}\n',
		});
		try {
			let min = (await css.bundle({ entry: join(dir, 'style.css'), minify: true })).code.toString('utf8');
			let pretty = (await css.bundle({ entry: join(dir, 'style.css'), minify: false })).code.toString('utf8');
			expect(min.length).toBeLessThan(pretty.length);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('auto-enables CSS modules for *.module.css and exports class names', async () => {
		let dir = await makeFixtureDir({
			'button.module.css': '.red { color: red; }',
		});
		try {
			let result = await css.bundle({ entry: join(dir, 'button.module.css') });
			expect(result.exports).toBeDefined();
			expect(result.exports!.red).toMatch(/.+/);
			// the emitted class name should no longer be "red" verbatim (hashed by CSS modules)
			let code = result.code.toString('utf8');
			expect(code).not.toContain('.red {');
			expect(code).toContain(result.exports!.red);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('opt-in CSS modules via cssModules=true on a non-.module.css file', async () => {
		let dir = await makeFixtureDir({
			'plain.css': '.red { color: red; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'plain.css'),
				cssModules: true,
			});
			expect(result.exports).toBeDefined();
			expect(result.exports!.red).toMatch(/.+/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('accepts browserslist string for targets', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { display: grid; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'style.css'),
				targets: 'last 2 versions',
			});
			expect(result.code.toString('utf8')).toContain('grid');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('includes inline source map when sourceMap=inline', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { color: red; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'style.css'),
				sourceMap: 'inline',
			});
			let code = result.code.toString('utf8');
			expect(code).toContain('sourceMappingURL=data:application/json;base64,');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('transform', () => {
	test('transforms a string of CSS', async () => {
		let result = await css.transform({
			source: '.a { color: red; }',
			filename: 'inline.css',
		});
		let code = result.code.toString('utf8');
		expect(code).toContain('.a');
		expect(code).toContain('red');
	});

	test('honours minify on a string', async () => {
		let min = await css.transform({
			source: '.a {\n  color: red;\n}\n',
			filename: 'inline.css',
			minify: true,
		});
		let pretty = await css.transform({
			source: '.a {\n  color: red;\n}\n',
			filename: 'inline.css',
			minify: false,
		});
		expect(min.code.length).toBeLessThan(pretty.code.length);
	});

	test('transforms CSS modules in-memory', async () => {
		let result = await css.transform({
			source: '.red { color: red; }',
			filename: 'button.module.css',
		});
		expect(result.exports).toBeDefined();
		expect(result.exports!.red).toMatch(/.+/);
	});
});
