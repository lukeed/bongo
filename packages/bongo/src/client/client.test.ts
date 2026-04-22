import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { on, off, emit, reset } from './index';

describe('event bus', () => {
	beforeEach(() => {
		reset();
	});

	test('on() returns an unsubscribe function', () => {
		let unsub = on('bongo:ready', () => {});
		expect(typeof unsub).toBe('function');
		unsub();
	});

	test('on() subscribes a handler; emit delivers a typed detail', () => {
		let received: { url: URL } | null = null;
		let url = new URL('https://example.com/');
		on('bongo:ready', (detail) => { received = detail; });
		emit('bongo:ready', { url });
		expect(received).not.toBeNull();
		expect((received as { url: URL } | null)!.url).toBe(url);
	});

	test('unsubscribe function stops delivery', () => {
		let count = 0;
		let unsub = on('bongo:after-swap', () => { count++; });
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		emit('bongo:after-swap', { to, from });
		expect(count).toBe(1);
		unsub();
		emit('bongo:after-swap', { to, from });
		expect(count).toBe(1); // still 1 — handler removed
	});

	test('off() removes a registered handler', () => {
		let count = 0;
		let fn = () => { count++; };
		on('bongo:before-nav', fn);
		off('bongo:before-nav', fn);
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/page');
		emit('bongo:before-nav', { to, from });
		expect(count).toBe(0);
	});

	test('multiple handlers on same event all fire', () => {
		let results: number[] = [];
		on('bongo:ready', () => { results.push(1); });
		on('bongo:ready', () => { results.push(2); });
		emit('bongo:ready', { url: new URL('https://example.com/') });
		expect(results).toEqual([1, 2]);
	});

	test('a throwing handler does not prevent other handlers from running', () => {
		let reached = false;
		on('bongo:error', () => { throw new Error('boom'); });
		on('bongo:error', () => { reached = true; });
		emit('bongo:error', { to: new URL('https://example.com/'), error: new Error('nav failed') });
		expect(reached).toBe(true);
	});
});

describe('navigate()', () => {
	test('falls back to location.assign when Navigation API is absent', () => {
		// bun:test has no browser globals — stub location on globalThis.
		let assigned: string | null = null;
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(url: string) { assigned = url; },
			replace(_url: string) {},
		};

		let { navigate } = require('./index');
		navigate('https://example.com/about');

		expect(assigned).toBe('https://example.com/about');

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});

	test('falls back to location.replace when replace:true and Navigation API is absent', () => {
		let replaced: string | null = null;
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(_url: string) {},
			replace(url: string) { replaced = url; },
		};

		let { navigate } = require('./index');
		navigate('https://example.com/old', { replace: true });

		expect(replaced).toBe('https://example.com/old');

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});
});
