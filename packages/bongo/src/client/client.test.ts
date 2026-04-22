import { describe, expect, test, beforeEach } from 'bun:test';
import { on, off, emit, reset, getBypassNext, setBypassNext } from './index';
import { resolvePreset } from './transitions';

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
		let unsub = on('bongo:swap:after', () => { count++; });
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		emit('bongo:swap:after', { to, from });
		expect(count).toBe(1);
		unsub();
		emit('bongo:swap:after', { to, from });
		expect(count).toBe(1); // still 1 — handler removed
	});

	test('off() removes a registered handler', () => {
		let count = 0;
		let fn = () => { count++; };
		on('bongo:nav:before', fn);
		off('bongo:nav:before', fn);
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/page');
		emit('bongo:nav:before', { to, from });
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

	test('bongo:nav:before fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:nav:before', (d) => { received = d; });
		emit('bongo:nav:before', { to, from });
		expect(received).not.toBeNull();
		expect(received!.to).toBe(to);
		expect(received!.from).toBe(from);
	});

	test('bongo:nav:after fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:nav:after', (d) => { received = d; });
		emit('bongo:nav:after', { to, from });
		expect(received).not.toBeNull();
		expect(received!.to).toBe(to);
	});

	test('bongo:swap:before fires with to/from/doc detail', () => {
		let received: { to: URL; from: URL; doc: Document } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		let doc = {} as Document;
		on('bongo:swap:before', (d) => { received = d; });
		emit('bongo:swap:before', { to, from, doc });
		expect(received).not.toBeNull();
		expect(received!.doc).toBe(doc);
	});

	test('bongo:swap:after fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:swap:after', (d) => { received = d; });
		emit('bongo:swap:after', { to, from });
		expect(received).not.toBeNull();
		expect(received!.to).toBe(to);
	});
});

describe('BYPASS_NEXT flag', () => {
	beforeEach(() => {
		reset();
	});

	test('getBypassNext returns false initially', () => {
		expect(getBypassNext()).toBe(false);
	});

	test('setBypassNext sets the flag; reset() clears it', () => {
		setBypassNext(true);
		expect(getBypassNext()).toBe(true);
		reset();
		expect(getBypassNext()).toBe(false);
	});

	test('setBypassNext(true) then setBypassNext(false) clears flag', () => {
		setBypassNext(true);
		setBypassNext(false);
		expect(getBypassNext()).toBe(false);
	});

	// Verifies the "consume once" contract used by the navigate handler:
	// shouldIntercept reads+clears the flag so the next navigation is not affected.
	test('flag is a one-shot: after being read true it must be manually cleared', () => {
		setBypassNext(true);
		// Simulate what shouldIntercept does internally:
		let val = getBypassNext();
		setBypassNext(false);
		expect(val).toBe(true);
		expect(getBypassNext()).toBe(false);
	});
});

describe('resolvePreset()', () => {
	test('true resolves to "fade"', () => {
		expect(resolvePreset(true)).toBe('fade');
	});

	test('"fade" resolves to "fade"', () => {
		expect(resolvePreset('fade')).toBe('fade');
	});

	test('"slide" resolves to "slide"', () => {
		expect(resolvePreset('slide')).toBe('slide');
	});

	test('"initial" resolves to "initial"', () => {
		expect(resolvePreset('initial')).toBe('initial');
	});

	test('false resolves to "none"', () => {
		expect(resolvePreset(false)).toBe('none');
	});

	test('"none" resolves to "none"', () => {
		expect(resolvePreset('none')).toBe('none');
	});

	test('undefined resolves to "none"', () => {
		expect(resolvePreset(undefined)).toBe('none');
	});

	test('custom string is returned as-is', () => {
		expect(resolvePreset('my-custom-preset')).toBe('my-custom-preset');
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
