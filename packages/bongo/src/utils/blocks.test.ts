import { beforeEach, describe, expect, test } from 'bun:test';

import * as bundler from './bundler';
import * as templates from './templates';

beforeEach(async () => {
	bundler.reset();
	templates.Partials.clear();
	templates.Layouts.clear();
});

describe('substitute', () => {
	test('swaps external <link href> placeholder with publicPath+filename', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:1234567890abcdef__' as never, { filename: 'style.abc123.css', dependencies: [] }],
		]);
		let html = '<link rel="stylesheet" href="__BONGO_BUNDLE:1234567890abcdef__"/>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<never, never>,
			publicPath: '/',
			readFile: async () => '',
		});
		expect(result).toBe('<link rel="stylesheet" href="/style.abc123.css"/>');
	});

	test('swaps external <script src> placeholder', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:aaaaaaaaaaaaaaaa__' as never, { filename: 'app.def456.js', dependencies: [] }],
		]);
		let html = '<script type="module" src="__BONGO_BUNDLE:aaaaaaaaaaaaaaaa__"></script>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<never, never>,
			publicPath: '/blog/',
			readFile: async () => '',
		});
		expect(result).toBe('<script type="module" src="/blog/app.def456.js"></script>');
	});

	test('inlines <style data-bongo-inline> with file contents', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:bbbbbbbbbbbbbbbb__' as never, { filename: 'a.123.css', dependencies: [] }],
		]);
		let html = '<style data-bongo-inline="__BONGO_BUNDLE:bbbbbbbbbbbbbbbb__"></style>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<never, never>,
			publicPath: '/',
			readFile: async () => '.a { color: red; }',
		});
		expect(result).toBe('<style>.a { color: red; }</style>');
	});

	test('inlines <script data-bongo-inline> preserving other attrs', async () => {
		let outputs = new Map([
			['__BONGO_BUNDLE:cccccccccccccccc__' as never, { filename: 'a.456.js', dependencies: [] }],
		]);
		let html = '<script async data-bongo-inline="__BONGO_BUNDLE:cccccccccccccccc__"></script>';
		let result = await templates.substitute(html, {
			outputs: outputs as Map<never, never>,
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
