import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test';
import * as prefetch from './prefetch';

const preconnect = globalThis.fetch.preconnect;

function respond(make: () => Response): typeof fetch {
	return Object.assign(async () => make(), { preconnect });
}

describe('prefetch.resolve()', () => {
	test('true resolves to "hover"', () => {
		expect(prefetch.resolve(true)).toBe('hover');
	});

	test('"hover" resolves to "hover"', () => {
		expect(prefetch.resolve('hover')).toBe('hover');
	});

	test('"tap" resolves to "tap"', () => {
		expect(prefetch.resolve('tap')).toBe('tap');
	});

	test('false resolves to undefined', () => {
		expect(prefetch.resolve(false)).toBeUndefined();
	});

	test('undefined resolves to undefined', () => {
		expect(prefetch.resolve(undefined)).toBeUndefined();
	});
});

describe('prefetch.get() / warm()', () => {
	let spy = spyOn(globalThis, 'fetch');

	beforeEach(() => {
		prefetch.reset();
	});

	afterEach(() => {
		spy.mockReset();
	});

	test('get() returns undefined for an un-warmed href', () => {
		expect(prefetch.get('https://example.com/unknown')).toBeUndefined();
	});

	test('warm() populates the cache; get() returns the pending HTML', async () => {
		spy.mockImplementation(respond(() => new Response('<html>page</html>', { status: 200 })));
		prefetch.warm('https://example.com/page');
		let pending = prefetch.get('https://example.com/page');
		expect(pending).toBeInstanceOf(Promise);
		expect(await pending!).toBe('<html>page</html>');
	});

	test('warm() is idempotent — a second warm for the same href reuses the entry', async () => {
		let calls = 0;
		spy.mockImplementation(respond(() => { calls++; return new Response('ok', { status: 200 }); }));
		prefetch.warm('https://example.com/a');
		prefetch.warm('https://example.com/a');
		await prefetch.get('https://example.com/a');
		expect(calls).toBe(1);
	});

	test('non-ok response is evicted so a future warm retries', async () => {
		spy.mockImplementation(respond(() => new Response('nope', { status: 404 })));
		prefetch.warm('https://example.com/missing');
		let pending = prefetch.get('https://example.com/missing');
		await expect(pending).rejects.toThrow(/404/);
		expect(prefetch.get('https://example.com/missing')).toBeUndefined();
	});
});

