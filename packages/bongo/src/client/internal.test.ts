import { describe, expect, test, beforeEach } from 'bun:test';
import { on, off } from './index';
import { emit, reset, getBypassNext, setBypassNext } from './internal';

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
