/// <reference lib="dom" />
import { afterEach, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import * as styles from './styles';

let win: Window | undefined;
let gates = new Map<string, PromiseWithResolvers<number>>();

function gate(url: string): PromiseWithResolvers<number> {
	let g = gates.get(url);
	if (!g) gates.set(url, g = Promise.withResolvers());
	return g;
}

function load(url: string, status = 200): void {
	gate(new URL(url, 'https://example.com').href).resolve(status);
}

function mount(url: string, head: string): void {
	let w: Window = win = new Window({
		url,
		settings: {
			fetch: {
				interceptor: {
					async beforeAsyncRequest({ request }) {
						let status = await gate(request.url).promise;
						return new w.Response('', { status, headers: { 'content-type': 'text/css' } });
					},
				},
			},
		},
	});
	w.document.write(`<!doctype html><html><head>${head}</head><body></body></html>`);
	Reflect.set(globalThis, 'document', w.document);
	Reflect.set(globalThis, 'DOMParser', w.DOMParser);
	styles.adopt(document);
}

function page(head: string): Document {
	return new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body></body></html>`, 'text/html');
}

function head(): string[] {
	return [ ...document.head.children ].map(el => el.outerHTML);
}

function find<E extends Element = HTMLLinkElement>(selector: string): E {
	let el = document.head.querySelector<E>(selector);
	if (!el) throw new Error(`missing ${selector}`);
	return el;
}

function fire(el: Element, type: string): void {
	let view = document.defaultView;
	if (view) el.dispatchEvent(new view.Event(type));
}

async function settled(p: Promise<void>): Promise<boolean> {
	let done = false;
	p.then(() => { done = true; });
	await Bun.sleep(10);
	return done;
}

afterEach(async () => {
	jest.useRealTimers();
	for (let g of gates.values()) g.resolve(200);
	gates.clear();
	await win?.happyDOM.close();
	Reflect.deleteProperty(globalThis, 'document');
	Reflect.deleteProperty(globalThis, 'DOMParser');
});

describe('styles.stage()', () => {
	test('loads new sheets disabled and enables them on commit', async () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/core.css">');
		let core = find('link[href="/core.css"]');
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/b.css">'), new AbortController().signal);

		expect(head()).toEqual([
			'<link rel="stylesheet" href="/core.css">',
			'<link rel="stylesheet" href="/b.css">',
		]);
		expect(await settled(stage.ready)).toBe(false);

		load('/b.css');
		await stage.ready;
		let b = find('link[href="/b.css"]');
		expect(b.sheet?.disabled).toBe(true);

		stage.commit();
		expect(b.sheet?.disabled).toBe(false);
		expect(find('link[href="/core.css"]')).toBe(core);
		expect(head()).toEqual([
			'<link rel="stylesheet" href="/core.css">',
			'<link rel="stylesheet" href="/b.css">',
		]);
	});

	test('removes sheets the new page does not use, on commit only', async () => {
		mount('https://example.com/b/', '<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/b.css">');
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/core.css">'), new AbortController().signal);
		await stage.ready;
		expect(head()).toHaveLength(2);

		stage.commit();
		expect(head()).toEqual([ '<link rel="stylesheet" href="/core.css">' ]);
	});

	test('keeps sheet order consistent with the new document', async () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">');
		let b = find('link[href="/b.css"]');
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/n.css"><link rel="stylesheet" href="/b.css"><link rel="stylesheet" href="/m.css"><link rel="stylesheet" href="/a.css">'), new AbortController().signal);
		for (let url of [ '/n.css', '/m.css', '/a.css' ]) load(url);
		await stage.ready;
		stage.commit();

		expect(head()).toEqual([
			'<link rel="stylesheet" href="/n.css">',
			'<link rel="stylesheet" href="/b.css">',
			'<link rel="stylesheet" href="/m.css">',
			'<link rel="stylesheet" href="/a.css">',
		]);
		expect(find('link[href="/b.css"]')).toBe(b);
	});

	test('matches <style> blocks by content and leaves sheets added by scripts', async () => {
		mount('https://example.com/', '<style>.a{}</style><style>.shared{}</style>');
		document.head.insertAdjacentHTML('beforeend', '<style data-bongo-preset="fade">.p{}</style><link rel="stylesheet" href="/widget.css">');
		let shared = find('style:nth-of-type(2)');

		let stage = styles.stage(document, page('<style>.shared{}</style><style>.b{}</style>'), new AbortController().signal);
		let b = [ ...document.head.querySelectorAll('style') ].find(el => el.textContent === '.b{}');
		expect(b?.sheet?.disabled).toBe(true);
		expect(await settled(stage.ready)).toBe(false);

		if (b) fire(b, 'load');
		await stage.ready;
		stage.commit();
		expect(b?.sheet?.disabled).toBe(false);

		expect(head()).toEqual([
			'<style>.shared{}</style>',
			'<style>.b{}</style>',
			'<style data-bongo-preset="fade">.p{}</style>',
			'<link rel="stylesheet" href="/widget.css">',
		]);
		expect(find('style')).toBe(shared);
	});

	test('waits only for sheets that apply', async () => {
		mount('https://example.com/', '');
		let stage = styles.stage(document, page([
			'<link rel="stylesheet" href="/print.css" media="print">',
			'<link rel="stylesheet" href="/wide.css" media="(min-width: 5000px)">',
			'<link rel="stylesheet" href="/off.css" disabled>',
			'<link rel="stylesheet" href="">',
		].join('')), new AbortController().signal);
		expect(await settled(stage.ready)).toBe(true);

		stage.commit();
		expect(head()).toEqual([
			'<link rel="stylesheet" href="/print.css" media="print">',
			'<link rel="stylesheet" href="/wide.css" media="(min-width: 5000px)">',
			'<link rel="stylesheet" href="/off.css" disabled="">',
			'<link rel="stylesheet" href="">',
		]);
	});

	test('treats a sheet with other media or disabled state as a new sheet', async () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/x.css" disabled>');
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/x.css">'), new AbortController().signal);
		expect(await settled(stage.ready)).toBe(false);

		load('/x.css');
		await stage.ready;
		stage.commit();
		expect(head()).toEqual([ '<link rel="stylesheet" href="/x.css">' ]);
	});

	test('ignores stylesheets inside <noscript>', async () => {
		mount('https://example.com/', '');
		let stage = styles.stage(document, page('<noscript><link rel="stylesheet" href="/ns.css"></noscript>'), new AbortController().signal);
		await stage.ready;
		stage.commit();
		expect(head()).toEqual([]);
	});

	test('matches a relative href by the URL it had when it was added', async () => {
		mount('https://example.com/a/', '<link rel="stylesheet" href="style.css">');
		let old = find('link');
		win?.happyDOM.setURL('https://example.com/b/');

		let stage = styles.stage(document, page('<link rel="stylesheet" href="style.css">'), new AbortController().signal);
		expect(await settled(stage.ready)).toBe(false);

		load('/b/style.css');
		await stage.ready;
		stage.commit();
		expect(head()).toEqual([ '<link rel="stylesheet" href="style.css">' ]);
		expect(find('link')).not.toBe(old);
	});

	test('settles when a sheet fails to load', async () => {
		mount('https://example.com/', '');
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/gone.css">'), new AbortController().signal);
		load('/gone.css', 404);
		await stage.ready;
		stage.commit();
		expect(head()).toEqual([ '<link rel="stylesheet" href="/gone.css">' ]);
	});

	test('stops waiting after 3 seconds', async () => {
		mount('https://example.com/', '');
		jest.useFakeTimers();
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/slow.css">'), new AbortController().signal);
		let done = false;
		stage.ready.then(() => { done = true; });

		jest.advanceTimersByTime(2_999);
		await Promise.resolve();
		expect(done).toBe(false);

		jest.advanceTimersByTime(1);
		await stage.ready;
	});

	test('settles on abort, and drop() removes what it staged', async () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/core.css">');
		let ctrl = new AbortController();
		let stage = styles.stage(document, page('<link rel="stylesheet" href="/b.css">'), ctrl.signal);
		ctrl.abort();
		await stage.ready;

		stage.drop();
		expect(head()).toEqual([ '<link rel="stylesheet" href="/core.css">' ]);
	});

	test('a superseded stage leaves no stray sheets; the last one wins', async () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/core.css">');
		let first = new AbortController();
		let b = styles.stage(document, page('<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/b.css">'), first.signal);
		first.abort();
		let c = styles.stage(document, page('<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/c.css">'), new AbortController().signal);

		await b.ready;
		b.drop();
		load('/c.css');
		await c.ready;
		c.commit();
		c.drop();

		expect(head()).toEqual([
			'<link rel="stylesheet" href="/core.css">',
			'<link rel="stylesheet" href="/c.css">',
		]);
	});
});

describe('styles.missing()', () => {
	test('lists the stylesheets a page would load that the document lacks', () => {
		mount('https://example.com/', '<link rel="stylesheet" href="/core.css">');
		let doc = page([
			'<link rel="stylesheet" href="/core.css">',
			'<link rel="stylesheet" href="b.css">',
			'<link rel="stylesheet" href="https://cdn.example.org/x.css">',
			'<link rel="stylesheet" href="/off.css" disabled>',
			'<link rel="stylesheet" href="">',
			'<link rel="stylesheet" href="/print.css" media="print">',
			'<noscript><link rel="stylesheet" href="/ns.css"></noscript>',
			'<link rel="stylesheet" href="b.css">',
		].join(''));

		expect(styles.missing(document, doc, 'https://example.com/b/')).toEqual([ 'https://example.com/b/b.css' ]);
	});
});
