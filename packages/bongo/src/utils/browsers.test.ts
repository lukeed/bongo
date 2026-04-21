import { describe, expect, test } from 'bun:test';
import * as browsers from './browsers';

describe('parse', () => {
	test('resolves a browserslist string to a lightningcss Targets object', () => {
		let targets = browsers.parse('last 2 versions');
		// At minimum chrome and firefox appear under "last 2 versions".
		expect(typeof targets.chrome).toBe('number');
		expect(typeof targets.firefox).toBe('number');
	});

	test('accepts an array of browserslist queries', () => {
		let targets = browsers.parse(['chrome 100', 'firefox 100']);
		// lightningcss packs version as (major << 16) | (minor << 8) | patch
		expect(targets.chrome! >> 16).toBe(100);
		expect(targets.firefox! >> 16).toBe(100);
	});
});

describe('translate', () => {
	test('emits engine+major entries from a Targets object', () => {
		let result = browsers.translate({
			chrome: 100 << 16,
			firefox: 99 << 16,
		});
		expect(result).toContain('chrome100');
		expect(result).toContain('firefox99');
	});

	test('maps ios_saf onto rolldown ios', () => {
		let result = browsers.translate({ ios_saf: 17 << 16 });
		expect(result).toEqual(['ios17']);
	});

	test('drops engines rolldown does not support (android, samsung)', () => {
		let result = browsers.translate({
			android: 147 << 16,
			samsung: 25 << 16,
		});
		expect(result).toEqual([]);
	});

	test('returns only rolldown-accepted engine names', () => {
		let accepted = new Set(['chrome', 'deno', 'edge', 'firefox', 'hermes', 'ie', 'ios', 'node', 'opera', 'rhino', 'safari']);
		let result = browsers.translate(browsers.parse('defaults'));
		for (let entry of result) {
			let engine = entry.match(/^([a-z]+)\d+$/)![1];
			expect(accepted.has(engine)).toBe(true);
		}
	});
});

describe('parse |> translate', () => {
	test('round-trips "last 2 versions" to rolldown format without errors', () => {
		let result = browsers.translate(browsers.parse('last 2 versions'));
		for (let entry of result) {
			expect(entry).toMatch(/^[a-z]+\d+$/);
		}
		expect(result.length).toBeGreaterThan(0);
	});
});
