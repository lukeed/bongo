import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as config from './config';

import type { Build } from 'bongo';

function makeBase() {
	return {
		$site: { url: '', lang: '', title: '', description: '', menu: {} },
		$utils: {
			truncate: (t: string, l: number) => t.substring(0, l),
			countwords: (t: string) => t.split(/\s+/g).length,
			url: { abs: (to: string) => to },
			date: { format: (v: any) => String(v) },
		},
		$assets: {},
		$partials: {},
		$hooks: {},
		plugins: [],
	} as any;
}

describe('merge', () => {
	test('merges $site properties', () => {
		let base = makeBase();
		config.merge(base, { $site: { title: 'My Site', url: 'https://example.com' } } as any);

		expect(base.$site.title).toBe('My Site');
		expect(base.$site.url).toBe('https://example.com');
		expect(base.$site.lang).toBe('');
	});

	test('merges $assets loaders', () => {
		let base = makeBase();
		let loader = () => ({});
		config.merge(base, { $assets: { md: loader } } as any);

		expect(base.$assets.md).toBe(loader);
	});

	test('merges $utils with nested objects', () => {
		let base = makeBase();
		let customAbs = (to: string) => '/custom' + to;
		config.merge(base, { $utils: { url: { abs: customAbs } } } as any);

		expect(base.$utils.url.abs).toBe(customAbs);
	});

	test('merges $utils scalar values', () => {
		let base = makeBase();
		let customTruncate = (t: string, l: number) => t.slice(0, l) + '...';
		config.merge(base, { $utils: { truncate: customTruncate } } as any);

		expect(base.$utils.truncate).toBe(customTruncate);
	});

	test('adds a $utils group that bongo does not have, and keeps the built-in groups', () => {
		let base = makeBase();
		let up = (text: string) => text.toUpperCase();
		config.merge(base, { $utils: { str: { up } } });
		expect(base.$utils.str.up).toBe(up);
		expect(typeof base.$utils.url.abs).toBe('function');
	});

	test('recursively merges plugins', () => {
		let base = makeBase();
		let plugin = {
			$site: { lang: 'en' },
		};
		config.merge(base, { plugins: [plugin] } as any);

		expect(base.$site.lang).toBe('en');
	});

	test('merges $partials', () => {
		let base = makeBase();
		let partial = () => 'rendered';
		config.merge(base, { $partials: { header: partial } } as any);

		expect(base.$partials.header).toBe(partial);
	});

	test('chains $hooks.transform: plugins in order, then the config\'s own, each given the last result', async () => {
		let base = makeBase();
		let append = (tag: string): Build.Transform => text => text + tag;
		config.merge(base, {
			plugins: [{ $hooks: { transform: append('a') } }, { $hooks: {} }, { $hooks: { transform: append('b') } }],
			$hooks: { transform: async text => text + 'c' },
		});

		let transform: Build.Transform = base.$hooks.transform;
		let ctx: Build.Context = { kind: 'page', path: '/', params: {}, outputs: [], config: base };
		expect(await transform('x', ctx)).toBe('xabc');
	});
});

const FIXTURE_TS = resolve(
	import.meta.dirname,
	'../../test/fixtures/config-ts-basic/bongo.config.ts',
);

async function sandbox(files: Record<string, string>): Promise<string> {
	let root = realpathSync(mkdtempSync(join(tmpdir(), 'bongo-config-')));
	for (let [rel, text] of Object.entries(files)) {
		mkdirSync(join(root, rel, '..'), { recursive: true });
		writeFileSync(join(root, rel), text);
	}
	return root;
}

async function failure(run: Promise<unknown>): Promise<config.LoadError> {
	try {
		await run;
	} catch (err) {
		if (err instanceof config.LoadError) return err;
		throw err;
	}
	throw new Error('expected a LoadError');
}

describe('loadModule', () => {
	test('loads a TypeScript config file and returns the default export', async () => {
		let mod = await config.loadModule(FIXTURE_TS);
		expect(mod.exports.default).toMatchObject({ $site: { url: 'https://example.com', title: 'Fixture Site' } });
	});

	test('loads an .mjs config file', async () => {
		let file = resolve(import.meta.dirname, '../../test/fixtures/config-mjs-basic/bongo.config.mjs');
		let mod = await config.loadModule(file);
		expect(mod.exports.default).toMatchObject({ $site: { url: 'https://example.com', title: 'MJS Fixture Site' } });
	});

	test('runs fresh code every time, imports included, and lists the files it read', async () => {
		let root = await sandbox({
			'entry.ts': `import { n } from './lib/n';\nimport list from './list.json' with { type: 'json' };\nexport default { n, list };`,
			'lib/n.ts': 'export const n: number = 1;',
			'list.json': '[1]',
		});
		try {
			let first = await config.loadModule(join(root, 'entry.ts'));
			expect(first.exports.default).toEqual({ n: 1, list: [1] });
			expect(first.files.toSorted()).toEqual([join(root, 'entry.ts'), join(root, 'lib/n.ts'), join(root, 'list.json')]);

			writeFileSync(join(root, 'lib/n.ts'), 'export const n: number = 2;');
			writeFileSync(join(root, 'list.json'), '[2]');
			let second = await config.loadModule(join(root, 'entry.ts'));
			expect(second.exports.default).toEqual({ n: 2, list: [2] });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('module-relative values point at each source file', async () => {
		let root = await sandbox({
			'entry.ts': [
				`import * as lib from './lib/where';`,
				`export default { url: import.meta.url, dir: import.meta.dirname, file: import.meta.filename, cjs: __dirname, lib };`,
			].join('\n'),
			'lib/where.ts': `const __filename = 'mine';\nexport const dir = import.meta.dirname;\nexport const own = __filename;`,
		});
		try {
			let mod = await config.loadModule(join(root, 'entry.ts'));
			expect(mod.exports.default).toEqual({
				url: pathToFileURL(join(root, 'entry.ts')).href,
				dir: root,
				file: join(root, 'entry.ts'),
				cjs: root,
				lib: { dir: join(root, 'lib'), own: 'mine' },
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('packages resolve as the runtime resolves them from the source file, and no temp file stays behind', async () => {
		let root = await sandbox({
			'node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', exports: { bun: './bun.js', node: './node.js', default: './node.js' } }),
			'node_modules/pkg/bun.js': `export default 'bun';`,
			'node_modules/pkg/node.js': `export default 'node';`,
			'entry.ts': `import pkg from 'pkg';\nexport default pkg;`,
		});
		try {
			let mod = await config.loadModule(join(root, 'entry.ts'));
			expect(mod.exports.default).toBe(typeof Bun === 'undefined' ? 'node' : 'bun');
			expect(mod.files).toEqual([join(root, 'entry.ts')]);
			expect(readdirSync(join(root, 'node_modules/.bongo'))).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a syntax error is a LoadError that names the place and lists the files read', async () => {
		let root = await sandbox({
			'entry.ts': `import { n } from './lib/n';\nexport default n;`,
			'lib/n.ts': 'export const n = ;',
		});
		try {
			let err = await failure(config.loadModule(join(root, 'entry.ts'), root));
			expect(err.message).toMatch(/Unexpected token \(lib\/n\.ts:1:\d+\)$/);
			expect(err.error).toMatchObject({ file: join(root, 'lib/n.ts'), line: 1 });
			expect(err.files.toSorted()).toEqual([join(root, 'entry.ts'), join(root, 'lib/n.ts')]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a module that throws is a LoadError that lists the files read', async () => {
		let root = await sandbox({
			'entry.ts': `import { n } from './lib/n';\nexport default n;`,
			'lib/n.ts': `export const n = 1;\nthrow new Error('boom');`,
		});
		try {
			let err = await failure(config.loadModule(join(root, 'entry.ts'), root));
			expect(err.message).toBe('boom (entry.ts)');
			expect(err.files.toSorted()).toEqual([join(root, 'entry.ts'), join(root, 'lib/n.ts')]);
			expect(readdirSync(tmpdir()).some(name => name.startsWith('entry.ts-'))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('load', () => {
	test('custom $utils keep the built-in helpers', async () => {
		let dir = resolve(import.meta.dirname, '../../test/fixtures/config-ts-utils');
		let output = await config.load(dir);
		let utils = output.config.$utils as Record<string, unknown> & { url: Record<string, unknown> };
		expect(typeof utils.year).toBe('function');
		expect(typeof utils.truncate).toBe('function');
		expect(typeof utils.countwords).toBe('function');
		expect(typeof utils.url.abs).toBe('function');
		expect(typeof utils.url.rel).toBe('function');
		expect(output.files.filter(file => !file.endsWith('tsconfig.json'))).toEqual([realpathSync(join(dir, 'bongo.config.ts'))]);
	});

	test('built-in countwords counts the words of a text', async () => {
		let dir = resolve(import.meta.dirname, '../../test/fixtures/config-ts-utils');
		let { $utils } = (await config.load(dir)).config;
		expect($utils.countwords?.('')).toBe(0);
		expect($utils.countwords?.('   ')).toBe(0);
		expect($utils.countwords?.('  one two\nthree ')).toBe(3);
	});
});
