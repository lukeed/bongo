import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { parseAttrs, scanBongoTags } from './tags';
import * as bundler from './bundler';

import type { Argv, Config } from 'bongo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tmpAssets(files: Record<string, string>): Promise<string> {
	let dir = join(tmpdir(), `bongo-tags-test-${randomBytes(6).toString('hex')}`);
	await mkdir(join(dir, 'assets'), { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let p = join(dir, 'assets', name);
			await mkdir(join(p, '..'), { recursive: true });
			await writeFile(p, contents);
		}),
	);
	return dir;
}

function makeArgv(dir: string): Required<Argv> {
	return {
		cwd: dir,
		src: dir,
		dest: join(dir, 'public'),
		assets: join(dir, 'assets'),
		content: join(dir, 'content'),
		partials: join(dir, 'partials'),
		layouts: join(dir, 'layouts'),
		debug: false,
		dev: false,
		minify: false,
		port: 3000,
		host: 'localhost',
	} as Required<Argv>;
}

function makeConfig(): Required<Config> {
	return {
		$site: { url: 'https://example.com', lang: '', title: '', description: '', menu: {} },
		$utils: {
			truncate: (t: string, l: number) => t.substring(0, l),
			countwords: (t: string) => t.split(/\s+/g).length,
			url: { abs: (to: string) => to },
			date: { format: (v: string | number | Date) => String(v) },
		},
		$assets: {},
		$partials: {},
		$build: {},
		plugins: [],
	} as Required<Config>;
}

beforeEach(() => {
	bundler.reset();
});

// ---------------------------------------------------------------------------
// parseAttrs unit tests
// ---------------------------------------------------------------------------

describe('parseAttrs', () => {
	test('parses double-quoted attribute', () => {
		let attrs = parseAttrs('src="app.css"');
		expect(attrs.src).toBe('app.css');
	});

	test('parses single-quoted attribute', () => {
		let attrs = parseAttrs("src='app.css'");
		expect(attrs.src).toBe('app.css');
	});

	test('parses bareword attribute', () => {
		let attrs = parseAttrs('src=app.css');
		expect(attrs.src).toBe('app.css');
	});

	test('boolean attribute (present, no value) becomes true', () => {
		let attrs = parseAttrs('inline');
		expect(attrs.inline).toBe(true);
	});

	test('parses multiple attributes', () => {
		let attrs = parseAttrs('src="main.ts" async inline');
		expect(attrs.src).toBe('main.ts');
		expect(attrs.async).toBe(true);
		expect(attrs.inline).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// scanBongoTags scanner tests
// ---------------------------------------------------------------------------

describe('scanBongoTags', () => {
	test('<bongo:style src> self-closing emits external <link>', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css" />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<link rel="stylesheet" href="__BONGO_BUNDLE:[a-f0-9]{16}__"\/>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:style src> paired form also emits external <link>', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css"></bongo:style>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<link rel="stylesheet" href="__BONGO_BUNDLE:[a-f0-9]{16}__"\/>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:style src inline> emits inline <style> marker', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css" inline></bongo:style>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<style data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/style>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src> emits external <script type=module>', async () => {
		let dir = await tmpAssets({ 'main.ts': 'export {}' });
		try {
			let html = '<bongo:script src="main.ts"></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<script type="module" src="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src inline> emits inline <script> marker', async () => {
		let dir = await tmpAssets({ 'boot.ts': 'export {}' });
		try {
			let html = '<bongo:script src="boot.ts" inline></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<script data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src async> includes async attr', async () => {
		let dir = await tmpAssets({ 'a.ts': 'export {}' });
		try {
			let html = '<bongo:script src="a.ts" async></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('async');
			expect(result).toContain('type="module"');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('multiple tags in one HTML string all get scanned', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}', 'b.ts': 'export {}' });
		try {
			let html = '<bongo:style src="a.css"></bongo:style>\n<bongo:script src="b.ts"></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('<link rel="stylesheet"');
			expect(result).toContain('<script type="module"');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('missing src throws', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:style></bongo:style>';
			expect(() => scanBongoTags(html, makeArgv(dir), makeConfig())).toThrow(/src/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('unknown tag <bongo:something> is left untouched', async () => {
		let dir = await tmpAssets({});
		try {
			// The scanner only matches `script` and `style` — other tag names pass through.
			let html = '<bongo:something src="x"></bongo:something>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toBe(html);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
