import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import * as bundler from './bundler';
import * as templates from './templates';

import type { Argv, Config } from 'bongo';

async function tmpProject(files: Record<string, string>): Promise<string> {
	let dir = join(tmpdir(), `bongo-blocks-test-${randomBytes(6).toString('hex')}`);
	await mkdir(join(dir, 'assets'), { recursive: true });
	await mkdir(join(dir, 'partials'), { recursive: true });
	await mkdir(join(dir, 'layouts'), { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let p = join(dir, name);
			await mkdir(join(p, '..'), { recursive: true });
			await writeFile(p, contents);
		}),
	);
	return dir;
}

function makeArgv(cwd: string): Required<Argv> {
	return {
		cwd,
		src: cwd,
		dest: join(cwd, 'public'),
		assets: join(cwd, 'assets'),
		content: join(cwd, 'content'),
		partials: join(cwd, 'partials'),
		layouts: join(cwd, 'layouts'),
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

beforeEach(async () => {
	bundler.reset();
	templates.Partials.clear();
	templates.Layouts.clear();
});

describe('<style src>', () => {
	test('registers a CSS entry and emits an inline placeholder', async () => {
		let dir = await tmpProject({ 'assets/a.css': '.a { color: red; }' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.style({ src: 'a.css' });
			expect(html).toMatch(/^<style data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/style>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('throws without src', async () => {
		let dir = await tmpProject({});
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			await expect(templates.blocks.style({})).rejects.toThrow(/src/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('<link rel=stylesheet href>', () => {
	test('emits an external <link/> with a placeholder in href', async () => {
		let dir = await tmpProject({ 'assets/a.css': '.a { color: red; }' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.link({ rel: 'stylesheet', href: 'a.css' });
			expect(html).toMatch(/^<link rel="stylesheet" href="__BONGO_BUNDLE:[a-f0-9]{16}__"\/>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('passes through non-stylesheet rels unchanged', async () => {
		let dir = await tmpProject({});
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.link({ rel: 'icon', href: '/favicon.ico' });
			expect(html).toBe('<link rel="icon" href="/favicon.ico"/>');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('<script src>', () => {
	test('default (no inline attr) emits an external <script src="…"></script>', async () => {
		let dir = await tmpProject({ 'assets/a.ts': 'export const x = 1;' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.script({ src: 'a.ts' });
			expect(html).toMatch(
				/^<script type="module" src="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('inline attr emits an inline-marker <script>', async () => {
		let dir = await tmpProject({ 'assets/a.ts': 'export const x = 1;' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.script({ src: 'a.ts', inline: true });
			expect(html).toMatch(/^<script data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('async attr appears in emitted tag', async () => {
		let dir = await tmpProject({ 'assets/a.ts': 'export const x = 1;' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.script({ src: 'a.ts', async: true });
			expect(html).toMatch(/<script async type="module" src="__BONGO_BUNDLE:/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('cjs format drops type=module; defer applies', async () => {
		let dir = await tmpProject({ 'assets/a.ts': 'export const x = 1;' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let html = await templates.blocks.script({ src: 'a.ts', format: 'cjs', defer: true });
			expect(html).not.toContain('type="module"');
			expect(html).toContain('defer');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('idempotent registration', () => {
	test('two calls with same src produce the same placeholder', async () => {
		let dir = await tmpProject({ 'assets/a.css': '.a {}' });
		try {
			let argv = makeArgv(dir);
			let config = makeConfig();
			await templates.collect(argv, config);
			let h1 = await templates.blocks.style({ src: 'a.css' });
			let h2 = await templates.blocks.style({ src: 'a.css' });
			expect(h1).toBe(h2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('<style src> with $build.targets', () => {
	test('passes targets through to the bundler config', async () => {
		// The placeholder is deterministic from (entry, cfg). If we register the same
		// entry with different cfgs (targets present vs absent), the placeholders differ.
		let dir = await tmpProject({ 'assets/a.css': '.a { color: red; }' });
		try {
			let argv = makeArgv(dir);
			let configA = makeConfig();
			await templates.collect(argv, configA);
			let hNoTargets = await templates.blocks.style({ src: 'a.css' });

			bundler.reset();
			let configB = makeConfig();
			configB.$build = { targets: 'last 2 versions' };
			await templates.collect(argv, configB);
			let hWithTargets = await templates.blocks.style({ src: 'a.css' });

			// Different cfgs → different placeholder tokens.
			let tokenA = hNoTargets.match(/__BONGO_BUNDLE:[a-f0-9]{16}__/)![0];
			let tokenB = hWithTargets.match(/__BONGO_BUNDLE:[a-f0-9]{16}__/)![0];
			expect(tokenA).not.toBe(tokenB);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('substitute', () => {
	test('swaps external <link href> placeholder with publicPath+filename', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:1234567890abcdef__' as any, { filename: 'style.abc123.css', dependencies: [] }],
		]);
		let html = '<link rel="stylesheet" href="__BONGO_BUNDLE:1234567890abcdef__"/>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<any, any>,
			publicPath: '/',
			readFile: async () => '',
		});
		expect(result).toBe('<link rel="stylesheet" href="/style.abc123.css"/>');
	});

	test('swaps external <script src> placeholder', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:aaaaaaaaaaaaaaaa__' as any, { filename: 'app.def456.js', dependencies: [] }],
		]);
		let html = '<script type="module" src="__BONGO_BUNDLE:aaaaaaaaaaaaaaaa__"></script>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<any, any>,
			publicPath: '/blog/',
			readFile: async () => '',
		});
		expect(result).toBe('<script type="module" src="/blog/app.def456.js"></script>');
	});

	test('inlines <style data-bongo-inline> with file contents', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:bbbbbbbbbbbbbbbb__' as any, { filename: 'a.123.css', dependencies: [] }],
		]);
		let html = '<style data-bongo-inline="__BONGO_BUNDLE:bbbbbbbbbbbbbbbb__"></style>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<any, any>,
			publicPath: '/',
			readFile: async () => '.a { color: red; }',
		});
		expect(result).toBe('<style>.a { color: red; }</style>');
	});

	test('inlines <script data-bongo-inline> preserving other attrs', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:cccccccccccccccc__' as any, { filename: 'a.456.js', dependencies: [] }],
		]);
		let html = '<script async data-bongo-inline="__BONGO_BUNDLE:cccccccccccccccc__"></script>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<any, any>,
			publicPath: '/',
			readFile: async () => 'console.log(1);',
		});
		expect(result).toBe('<script async>console.log(1);</script>');
	});

	test('throws on unresolved placeholder', async () => {
		let html = '<link href="__BONGO_BUNDLE:deadbeefdeadbeef__"/>';
		await expect(templates.substitute(html, {
			outputs: new Map(),
			publicPath: '/',
			readFile: async () => '',
		})).rejects.toThrow(/Unresolved/);
	});
});
