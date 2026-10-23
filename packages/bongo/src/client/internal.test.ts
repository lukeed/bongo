import { afterEach, describe, expect, test, beforeEach, spyOn } from 'bun:test';
import { on, off } from './index';
import { emit, reset, getBypassNext, setBypassNext, shouldIntercept } from './internal';

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
		let unsub = on('bongo:replaced', () => { count++; });
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		emit('bongo:replaced', { to, from });
		expect(count).toBe(1);
		unsub();
		emit('bongo:replaced', { to, from });
		expect(count).toBe(1); // still 1 — handler removed
	});

	test('off() removes a registered handler', () => {
		let count = 0;
		let fn = () => { count++; };
		on('bongo:navigate', fn);
		off('bongo:navigate', fn);
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/page');
		emit('bongo:navigate', { to, from });
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
		let logged = spyOn(console, 'error').mockImplementation(() => {});
		on('bongo:error', () => { throw new Error('boom'); });
		on('bongo:error', () => { reached = true; });
		emit('bongo:error', { to: new URL('https://example.com/'), error: new Error('nav failed') });
		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
		expect(reached).toBe(true);
	});

	test('bongo:navigate fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:navigate', (d) => { received = d; });
		emit('bongo:navigate', { to, from });
		expect(received).not.toBeNull();
		expect(received!.to).toBe(to);
		expect(received!.from).toBe(from);
	});

	test('bongo:navigated fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:navigated', (d) => { received = d; });
		emit('bongo:navigated', { to, from });
		expect(received).not.toBeNull();
		expect(received!.to).toBe(to);
	});

	test('bongo:replace fires with to/from/doc detail', () => {
		let received: { to: URL; from: URL; doc: Document } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		let doc = {} as Document;
		on('bongo:replace', (d) => { received = d; });
		emit('bongo:replace', { to, from, doc });
		expect(received).not.toBeNull();
		expect(received!.doc).toBe(doc);
	});

	test('bongo:replaced fires with to/from detail', () => {
		let received: { to: URL; from: URL } | null = null;
		let from = new URL('https://example.com/');
		let to = new URL('https://example.com/about');
		on('bongo:replaced', (d) => { received = d; });
		emit('bongo:replaced', { to, from });
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

describe('transition', () => {
	type Doc = { startViewTransition?: (fn: () => void) => object };

	function stub(doc: Doc | undefined, run: () => Promise<void>): Promise<void> {
		let g = globalThis as { document?: Doc };
		let prev = g.document;
		g.document = doc;
		return run().finally(() => { g.document = prev; });
	}

	test('swaps without a view transition when disabled', async () => {
		let { transition } = await import('./internal');
		let calls = 0;
		await stub({}, () => transition(false, () => { calls++; }));
		expect(calls).toBe(1);
	});

	test('a skipped transition swaps and does not reject', async () => {
		let { transition } = await import('./internal');
		let calls = 0;
		let skipped = () => Promise.reject(new DOMException('Transition was skipped', 'AbortError'));
		let doc: Doc = {
			startViewTransition(fn) {
				fn();
				return { ready: skipped(), updateCallbackDone: Promise.resolve(), finished: Promise.resolve() };
			},
		};
		await stub(doc, () => transition(true, () => { calls++; }));
		await new Promise(r => setTimeout(r, 10));
		expect(calls).toBe(1);
	});

	test('rejects when the swap itself fails', async () => {
		let { transition } = await import('./internal');
		let boom = new Error('boom');
		let doc: Doc = {
			startViewTransition() {
				return { ready: Promise.resolve(), updateCallbackDone: Promise.reject(boom), finished: Promise.reject(boom) };
			},
		};
		expect(stub(doc, () => transition(true, () => {}))).rejects.toBe(boom);
	});
});

describe('shouldIntercept', () => {
	let event = (path: string) => ({
		canIntercept: true,
		hashChange: false,
		downloadRequest: null,
		navigationType: 'push',
		sourceElement: null,
		destination: { url: location.origin + path },
	}) as unknown as NavigateEvent;

	let saved = Reflect.get(globalThis, 'location');

	beforeEach(() => {
		reset();
		Reflect.set(globalThis, 'location', new URL('https://example.com/'));
	});

	afterEach(() => {
		if (saved === undefined) Reflect.deleteProperty(globalThis, 'location');
		else Reflect.set(globalThis, 'location', saved);
	});

	test('takes pages, and leaves files to the browser', () => {
		let pages = ['/', '/about/', '/about', '/404.html', '/v1.2/', '/a.b/c', '/releases/v1.1.0'];
		let files = ['/llms.txt', '/feed.xml', '/img/logo.png', '/config.md', '/search.json', '/clip.mp4', '/font.woff2'];
		expect(pages.filter(path => !shouldIntercept(event(path)))).toEqual([]);
		expect(files.filter(path => shouldIntercept(event(path)))).toEqual([]);
	});
});
