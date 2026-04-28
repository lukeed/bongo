import { describe, expect, test } from 'bun:test';
import * as config from './config';
import { resolve } from 'node:path';

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
		$build: {},
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

	test('recursively merges plugins', () => {
		let base = makeBase();
		let plugin = {
			$site: { lang: 'en' },
		};
		config.merge(base, { plugins: [plugin] } as any);

		expect(base.$site.lang).toBe('en');
	});

	test('composes plugin hooks before root hooks', async () => {
		let base = makeBase();
		let calls: string[] = [];
		config.merge(base, {
			plugins: [{
				$hooks: {
					pages() {
						calls.push('plugin');
					},
				},
			}],
			$hooks: {
				pages() {
					calls.push('root');
				},
			},
		});

		await base.$hooks.pages({
			config: base,
			pages: [],
			sections: new Map(),
			tags: [],
		});

		expect(calls).toEqual(['plugin', 'root']);
	});

	test('merges $partials', () => {
		let base = makeBase();
		let partial = () => 'rendered';
		config.merge(base, { $partials: { header: partial } } as any);

		expect(base.$partials.header).toBe(partial);
	});
});

const FIXTURE_TS = resolve(
	import.meta.dirname,
	'../../test/fixtures/config-ts-basic/bongo.config.ts',
);

describe('loadModule', () => {
	test('loads a TypeScript config file and returns the default export', async () => {
		let mod = await config.loadModule(FIXTURE_TS) as { default: { $site: { url: string; title: string } } };
		expect(mod.default.$site.url).toBe('https://example.com');
		expect(mod.default.$site.title).toBe('Fixture Site');
	});

	test('loads a non-TS config file via direct import', async () => {
		let file = resolve(
			import.meta.dirname,
			'../../test/fixtures/config-mjs-basic/bongo.config.mjs',
		);
		let mod = await config.loadModule(file) as { default: { $site: { url: string; title: string } } };
		expect(mod.default.$site.url).toBe('https://example.com');
		expect(mod.default.$site.title).toBe('MJS Fixture Site');
	});
});
