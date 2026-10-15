import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as config from './config';

import type { Build, Config } from 'bongo';

function makeBase() {
	return {
		$site: { url: '', lang: '', title: '', description: '', menu: {} },
		$utils: {
			truncate: (t: string, l: number) => t.substring(0, l),
			countwords: (t: string) => t.split(/\s+/g).length,
			url: { abs: (to: string) => to },
			date: { format: (v: any) => String(v) },
		},
		$loaders: {},
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

	test('merges $loaders', () => {
		let base = makeBase();
		let loader = () => ({ filename: '', content: '' });
		config.merge(base, { $loaders: { md: loader } });

		expect(base.$loaders.md).toBe(loader);
	});

	test('a config or plugin that still sets $assets fails with the new name', () => {
		let base = makeBase();
		expect(() => config.merge(base, { $assets: {} } as Partial<Config>)).toThrow('`$assets` is now `$loaders`');
		expect(() => config.merge(base, { plugins: [{ $assets: {} } as Partial<Config>] })).toThrow('`$assets` is now `$loaders`');
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

	test('a package linked from outside node_modules runs fresh every time, and its files are listed', async () => {
		let root = await sandbox({
			'pkgs/linked/package.json': JSON.stringify({ name: 'linked', type: 'module', exports: './index.js' }),
			'pkgs/linked/index.js': `import { n } from './n.js';\nimport dep from 'dep';\nexport default { n, dep, dir: import.meta.dirname };`,
			'pkgs/linked/n.js': 'export const n = 1;',
			'pkgs/linked/node_modules/dep/package.json': JSON.stringify({ name: 'dep', type: 'module', exports: './index.js' }),
			'pkgs/linked/node_modules/dep/index.js': `export default 'dep';`,
			'pkgs/legacy/package.json': JSON.stringify({ name: 'legacy' }),
			'pkgs/legacy/index.js': `module.exports = { dep: require('dep').default };`,
			'pkgs/legacy/node_modules/dep/package.json': JSON.stringify({ name: 'dep', type: 'module', exports: './index.js' }),
			'pkgs/legacy/node_modules/dep/index.js': `export default 'legacy dep';`,
			'site/entry.ts': `import linked from 'linked';\nimport legacy from 'legacy';\nexport default { linked, legacy };`,
		});
		mkdirSync(join(root, 'site/node_modules'));
		symlinkSync(join(root, 'pkgs/linked'), join(root, 'site/node_modules/linked'));
		symlinkSync(join(root, 'pkgs/legacy'), join(root, 'site/node_modules/legacy'));
		try {
			let first = await config.loadModule(join(root, 'site/entry.ts'));
			expect(first.exports.default).toEqual({
				linked: { n: 1, dep: 'dep', dir: join(root, 'pkgs/linked') },
				legacy: { dep: 'legacy dep' },
			});
			expect(first.files.toSorted()).toEqual([
				join(root, 'pkgs/legacy/index.js'),
				join(root, 'pkgs/linked/index.js'),
				join(root, 'pkgs/linked/n.js'),
				join(root, 'site/entry.ts'),
			]);

			writeFileSync(join(root, 'pkgs/linked/n.js'), 'export const n = 2;');
			let second = await config.loadModule(join(root, 'site/entry.ts'));
			expect(second.exports.default).toMatchObject({ linked: { n: 2 } });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('bongo itself stays a package, even when it is linked', async () => {
		let bongo = resolve(import.meta.dirname, '../..');
		let root = await sandbox({
			'entry.ts': `import * as bongo from 'bongo';\nexport default typeof bongo.build;`,
		});
		mkdirSync(join(root, 'node_modules'));
		symlinkSync(bongo, join(root, 'node_modules/bongo'));
		try {
			let mod = await config.loadModule(join(root, 'entry.ts'));
			expect(mod.exports.default).toBe('function');
			expect(mod.files).toEqual([join(root, 'entry.ts')]);
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

	test('$build.target is the browserslist "defaults" query, unless a plugin or the config sets it', async () => {
		let target = async (body: string) => {
			let dir = mkdtempSync(join(tmpdir(), 'bongo-target-'));
			writeFileSync(join(dir, 'bongo.config.ts'), `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, ${body} };`);
			try {
				return (await config.load(dir)).config.$build.target;
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		};
		expect(await target('')).toBe('defaults');
		expect(await target(`$build: {}`)).toBe('defaults');
		expect(await target(`$build: { target: 'last 2 chrome versions' }`)).toBe('last 2 chrome versions');
		expect(await target(`$build: { target: ['chrome >= 120', 'safari >= 17'] }`)).toEqual(['chrome >= 120', 'safari >= 17']);
		expect(await target(`plugins: [{ $build: { target: 'safari >= 17' } }]`)).toBe('safari >= 17');
	});

	test('built-in countwords counts the words of a text', async () => {
		let dir = resolve(import.meta.dirname, '../../test/fixtures/config-ts-utils');
		let { $utils } = (await config.load(dir)).config;
		expect($utils.countwords?.('')).toBe(0);
		expect($utils.countwords?.('   ')).toBe(0);
		expect($utils.countwords?.('  one two\nthree ')).toBe(3);
	});
});

async function builtins(site: string): Promise<NonNullable<Config['$utils']>> {
	let dir = mkdtempSync(join(tmpdir(), 'bongo-utils-'));
	writeFileSync(join(dir, 'bongo.config.ts'), `export default { $site: ${site} };`);
	try {
		return (await config.load(dir)).config.$utils;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('built-in utils', () => {
	test('url.abs resolves a path to a full URL under $site.url', async () => {
		let { url } = await builtins(`{ url: 'https://example.com/blog', lang: 'en', title: 'T' }`);
		expect(url?.abs?.('post/')).toBe('https://example.com/blog/post/');
		expect(url?.abs?.('/about/')).toBe('https://example.com/about/');
		expect(url?.abs?.('a', 'https://cdn.example.com/x/')).toBe('https://cdn.example.com/x/a');
	});

	test('url.path resolves a path against $site.url, keeps the query and hash, and leaves a full site path alone', async () => {
		let { url } = await builtins(`{ url: 'https://example.com/blog', lang: 'en', title: 'T' }`);
		expect(url?.path?.('docs/')).toBe('/blog/docs/');
		expect(url?.path?.('/about/')).toBe('/about/');
		expect(url?.path?.('/blog/post/')).toBe('/blog/post/');
		expect(url?.path?.('docs/?q=a b#top')).toBe('/blog/docs/?q=a%20b#top');
		expect(url?.path?.('a', 'https://cdn.example.com/x/')).toBe('/x/a');
		expect(url?.path?.('https://other.com/y')).toBe('/y');
	});

	test('url.ext gives the path of a page plus an extension, as <bongo:alternate> writes it', async () => {
		let { url } = await builtins(`{ url: 'https://example.com/', lang: 'en', title: 'T' }`);
		expect(url?.ext?.('/config/', 'md')).toBe('/config.md');
		expect(url?.ext?.('/', 'md')).toBe('/index.md');
		expect(url?.ext?.('/blog/post/', '.md')).toBe('/blog/post.md');
		expect(url?.ext?.('/404.html', 'md')).toBe('/404.md');
		expect(url?.ext?.('/about', 'txt')).toBe('/about.txt');
		let sub = (await builtins(`{ url: 'https://example.com/docs/', lang: 'en', title: 'T' }`)).url;
		expect(sub?.ext?.('/docs/', 'md')).toBe('/docs/index.md');
		expect(sub?.ext?.('/docs/config/', 'md')).toBe('/docs/config.md');
	});

	test('slug makes a GitHub-style anchor slug, as md4x does for heading ids', async () => {
		let { slug } = await builtins(`{ url: 'https://example.com/', lang: 'en', title: 'T' }`);
		expect(slug?.('Hello, world!')).toBe('hello-world');
		expect(slug?.('<bongo:style> attributes')).toBe('bongostyle-attributes');
		expect(slug?.('Über-Straße')).toBe('über-strasse');
		expect(slug?.('  Version 2.0  notes ')).toBe('version-20--notes');
		expect(slug?.('a_b—c 🎉')).toBe('a_bc-');
		expect(slug?.('')).toBe('');
	});

	test('excerpt gives plain text, cut at a word, with … only when it cuts', async () => {
		let { excerpt } = await builtins(`{ url: 'https://example.com/', lang: 'en', title: 'T' }`);
		expect(excerpt?.('<p>Hello <b>big</b> world &amp; friends</p>', 15)).toBe('Hello big world…');
		expect(excerpt?.('<p>One, two three</p>', 4)).toBe('One…');
		expect(excerpt?.('Supercalifragilistic', 5)).toBe('Super…');
		expect(excerpt?.('short', 10)).toBe('short');
		expect(excerpt?.('', 5)).toBe('');
		expect(excerpt?.('<h2>Title</h2><p>a</p>\n\n<p>b<br>c</p><script>x()</script><!-- note -->', 99)).toBe('Title a b c');
		expect(excerpt?.('a &lt;b&gt; &#169; &#x263A; &quot;q&quot; it&#39;s&nbsp;ok', 99)).toBe('a <b> © ☺ "q" it\'s ok');
		expect(excerpt?.('&#99999999; &bogus; &AMP;', 99)).toBe('&#99999999; &bogus; &');
	});

	test('minutes gives the reading time in whole minutes, from the words of the text without its tags', async () => {
		let { minutes } = await builtins(`{ url: 'https://example.com/', lang: 'en', title: 'T' }`);
		expect(minutes?.('')).toBe(0);
		expect(minutes?.('<p> </p>')).toBe(0);
		expect(minutes?.('<p>one</p>')).toBe(1);
		expect(minutes?.('<p>' + 'word '.repeat(200) + '</p>')).toBe(1);
		expect(minutes?.('word '.repeat(201))).toBe(2);
		expect(minutes?.('word '.repeat(250), 100)).toBe(3);
		expect(minutes?.('<b>a</b><i>b</i> <script>let x = 1 2 3 4</script>c', 1)).toBe(2);
	});

	test('json gives JSON that is safe inside a <script> element', async () => {
		let { json } = await builtins(`{ url: 'https://example.com/', lang: 'en', title: 'T' }`);
		let value = { a: '</script><!--', b: 'x & y', c: 'line\u2028para\u2029', n: [1, null] };
		let out = json?.(value) ?? '';
		expect(out).toBe('{"a":"\\u003c/script\\u003e\\u003c!--","b":"x \\u0026 y","c":"line\\u2028para\\u2029","n":[1,null]}');
		expect(JSON.parse(out)).toEqual(value);
		expect(json?.(undefined)).toBe('null');
	});

	test('date.format gives ISO 8601, or a date in $site.lang from Intl options, in UTC', async () => {
		let { date } = await builtins(`{ url: 'https://example.com/', lang: 'fr', title: 'T' }`);
		expect(date?.format?.('2024-05-01')).toBe('2024-05-01T00:00:00.000Z');
		expect(date?.format?.('2024-05-01', { dateStyle: 'long' })).toBe('1 mai 2024');
		expect(date?.format?.('2024-05-01T23:30:00Z', { day: 'numeric' })).toBe('1');
		expect(date?.format?.('2024-05-01', { dateStyle: 'medium', timeZone: 'America/Los_Angeles' })).toBe('30 avr. 2024');
		expect(() => date?.format?.('nope')).toThrow('Invalid date: "nope"');
	});
});
