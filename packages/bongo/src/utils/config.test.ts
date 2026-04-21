import { describe, expect, test } from 'vitest';
import * as config from './config';

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

	test('merges $partials', () => {
		let base = makeBase();
		let partial = () => 'rendered';
		config.merge(base, { $partials: { header: partial } } as any);

		expect(base.$partials.header).toBe(partial);
	});
});
