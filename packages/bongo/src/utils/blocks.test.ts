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
