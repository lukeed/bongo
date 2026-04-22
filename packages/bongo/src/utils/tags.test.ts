import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { parseAttrs, scanBongoTags, rewriteTransitionAttrs } from './tags';
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
			// The scanner only matches `script`, `style`, and `client` — other tag names pass through.
			let html = '<bongo:something src="x"></bongo:something>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toBe(html);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client /> emits announcer + ESM script that imports and calls client({})', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(
				/^<div id="bongo:live"[^>]+><\/div><script type="module">import { client } from "__BONGO_BUNDLE:[a-f0-9]{16}__"; client\({}\);<\/script>$/,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> boolean attrs become true in the options object', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client transitions />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('client({ transitions: true });');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> always emits the aria announcer div before the bootstrap script', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('<div id="bongo:live" role="status" aria-live="polite"');
			expect(result.indexOf('id="bongo:live"')).toBeLessThan(result.indexOf('<script'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> string attrs become quoted values', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client transitions="slide" />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('client({ transitions: "slide" });');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> repeated on the same page bundles the runtime once', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client /><bongo:client transitions />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			let matches = result.match(/__BONGO_BUNDLE:[a-f0-9]{16}__/g) ?? [];
			// Both tags reference the same placeholder — bundler.register is idempotent
			// per (entry, cfg) pair, so repeated scans produce one registration.
			expect(matches.length).toBe(2);
			expect(matches[0]).toBe(matches[1]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// rewriteTransitionAttrs tests
// ---------------------------------------------------------------------------

describe('rewriteTransitionAttrs', () => {
	test('transition:name adds view-transition-name to style', () => {
		let html = '<aside transition:name="sidebar">content</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('style="view-transition-name: sidebar"');
		expect(result).not.toContain('transition:name');
	});

	test('transition:name merges into existing style attr', () => {
		let html = '<aside style="color:red" transition:name="sidebar">x</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: sidebar');
		expect(result).toContain('color:red');
		expect(result).not.toContain('transition:name');
	});

	test('transition:animate injects ::view-transition-* rule into <style data-bongo-transitions>', () => {
		let html = '<head></head><body><nav transition:name="nav" transition:animate="slide">x</nav></body>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('data-bongo-transitions');
		expect(result).toContain('::view-transition-old(nav)');
		expect(result).toContain('::view-transition-new(nav)');
		expect(result).toContain('animation-name:slide');
		expect(result).not.toContain('transition:animate');
	});

	test('transition:animate without transition:name uses auto-generated name', () => {
		let html = '<head></head><body><section transition:animate="shake">x</section></body>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toMatch(/view-transition-name: bongo-auto-[0-9a-f]+/);
		expect(result).toMatch(/::view-transition-old\(bongo-auto-[0-9a-f]+\)/);
	});

	test('no transition attrs — html unchanged', () => {
		let html = '<aside class="foo">content</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toBe(html);
	});

	test('self-closing element with transition:name is handled correctly', () => {
		let html = '<img transition:name="hero" src="a.png" />';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: hero');
		expect(result).not.toContain('transition:name');
	});

	test('<style data-bongo-transitions> is injected before </head>', () => {
		let html = '<html><head><title>T</title></head><body><span transition:name="x" transition:animate="fade">y</span></body></html>';
		let result = rewriteTransitionAttrs(html);
		let headClose = result.indexOf('</head>');
		let styleIdx = result.indexOf('<style data-bongo-transitions>');
		expect(styleIdx).toBeGreaterThan(-1);
		expect(styleIdx).toBeLessThan(headClose);
	});

	test('multiple elements each get their own rule', () => {
		let html = '<head></head><p transition:name="a" transition:animate="k1">1</p><p transition:name="b" transition:animate="k2">2</p>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('::view-transition-old(a)');
		expect(result).toContain('::view-transition-old(b)');
		expect(result).toContain('animation-name:k1');
		expect(result).toContain('animation-name:k2');
	});

	test('single-quoted transition:name is also handled', () => {
		let html = "<aside transition:name='hero'>x</aside>";
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: hero');
		expect(result).not.toContain('transition:name');
	});
});
