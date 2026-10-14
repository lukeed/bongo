import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';

describe('navigate()', () => {
	test('falls back to location.assign when Navigation API is absent', () => {
		// bun:test has no browser globals — stub location on globalThis.
		let assigned: string[] = [];
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(url: string) { assigned.push(url); },
			replace(_url: string) {},
		};

		let { navigate } = require('./index');
		navigate('https://example.com/about');

		expect(assigned).toEqual(['https://example.com/about']);

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});

	test('falls back to location.replace when replace:true and Navigation API is absent', () => {
		let replaced: string[] = [];
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(_url: string) {},
			replace(url: string) { replaced.push(url); },
		};

		let { navigate } = require('./index');
		navigate('https://example.com/old', { replace: true });

		expect(replaced).toEqual(['https://example.com/old']);

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});
});

describe('navigate() with the Navigation API', () => {
	type Nav = { navigate: () => { committed: Promise<unknown>; finished: Promise<unknown> } };

	async function withNavigation(nav: Nav, run: () => Promise<void>): Promise<void> {
		let prev = [Reflect.get(globalThis, 'navigation'), Reflect.get(globalThis, 'location')];
		Reflect.set(globalThis, 'navigation', nav);
		Reflect.set(globalThis, 'location', { href: 'https://example.com/' });
		try { await run(); }
		finally {
			Reflect.set(globalThis, 'navigation', prev[0]);
			Reflect.set(globalThis, 'location', prev[1]);
		}
	}

	test('resolves when a newer navigation supersedes it', async () => {
		let abort = () => Promise.reject(new DOMException('aborted', 'AbortError'));
		await withNavigation({ navigate: () => ({ committed: abort(), finished: abort() }) }, async () => {
			let { navigate } = await import('./index');
			await navigate('/about');
		});
		await new Promise(r => setTimeout(r, 10));
	});

	test('rejects on real failures', async () => {
		let boom = new Error('Navigation fetch failed: 500');
		await withNavigation({ navigate: () => ({ committed: Promise.resolve(), finished: Promise.reject(boom) }) }, async () => {
			let { navigate } = await import('./index');
			expect(navigate('/about')).rejects.toBe(boom);
		});
	});
});

describe('client() navigation', () => {
	type Page = { head: string; body: string };
	type Visit = { abort(): void; done: Promise<void> };

	let CORE = '<link rel="stylesheet" href="/core.css">';
	let PAGES: Record<string, Page> = {
		'/': { head: '<title>A</title>' + CORE, body: '<h1>A</h1>' },
		'/b/': { head: '<title>B</title>' + CORE + '<link rel="stylesheet" href="/b.css">', body: '<h1>B</h1>' },
		'/c/': { head: '<title>C</title>' + CORE + '<link rel="stylesheet" href="/c.css">', body: '<h1>C</h1><div id="bongo:live"></div>' },
	};
	let GLOBALS = [ 'document', 'DOMParser', 'location', 'history', 'window', 'navigation' ];

	let win: Window | undefined;
	let nav = new EventTarget();
	let log: string[] = [];
	let saved = new Map<string, unknown>();
	let gates = new Map<string, PromiseWithResolvers<void>>();
	let spy = spyOn(globalThis, 'fetch');

	function gate(url: string): PromiseWithResolvers<void> {
		let g = gates.get(url);
		if (!g) gates.set(url, g = Promise.withResolvers());
		return g;
	}

	function load(path: string): void {
		gate('https://example.com' + path).resolve();
	}

	function html(path: string): string {
		let page = PAGES[ path ];
		return `<!doctype html><html><head>${page.head}</head><body>${page.body}</body></html>`;
	}

	function sheets(): string[] {
		return [ ...document.head.querySelectorAll('link') ].map(l => {
			let state = !l.sheet ? 'pending' : l.sheet.disabled ? 'off' : '';
			return [ l.getAttribute('href'), l.getAttribute('media'), state ].filter(Boolean).join(' ');
		});
	}

	function heading(): string | undefined {
		return document.querySelector('h1')?.textContent;
	}

	function go(path: string, type: NavigationType = 'push'): Visit {
		let ctrl = new AbortController();
		let url = 'https://example.com' + path;
		let run: (() => Promise<void>) | undefined;
		nav.dispatchEvent(Object.assign(new Event('navigate'), {
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			sourceElement: null,
			navigationType: type,
			destination: { url },
			signal: ctrl.signal,
			intercept(opts: { handler: () => Promise<void> }) { run = opts.handler; },
		}));
		win?.happyDOM.setURL(url);
		return { abort: () => ctrl.abort(), done: run ? run() : Promise.reject(new Error('not intercepted')) };
	}

	async function boot(): Promise<void> {
		let { client } = await import('./index');
		let { reset } = await import('./prefetch');
		reset();
		let w: Window = win = new Window({
			url: 'https://example.com/',
			settings: {
				enableCSSFileLoading: true,
				fetch: {
					interceptor: {
						async beforeAsyncRequest({ request }) {
							await gate(request.url).promise;
							return new w.Response('', { headers: { 'content-type': 'text/css' } });
						},
					},
				},
			},
		});
		w.document.write(html('/'));
		Reflect.set(w.document, 'startViewTransition', (swap: () => void) => {
			log.push(sheets().join(' '));
			let done = Promise.resolve().then(swap);
			return { ready: done, updateCallbackDone: done, finished: done };
		});
		nav = new EventTarget();
		let values: unknown[] = [ w.document, w.DOMParser, w.location, w.history, w, nav ];
		GLOBALS.forEach((key, i) => {
			saved.set(key, Reflect.get(globalThis, key));
			Reflect.set(globalThis, key, values[ i ]);
		});
		spy.mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
			return new Response(html(new URL(String(input)).pathname));
		}, { preconnect: fetch.preconnect }));
		load('/core.css');
		await w.happyDOM.waitUntilComplete();
		client({ transitions: true });
	}

	afterEach(async () => {
		let [ internal, prefetch ] = await Promise.all([ import('./internal'), import('./prefetch') ]);
		internal.reset();
		prefetch.reset();
		spy.mockReset();
		for (let [ key, value ] of saved) {
			if (value === undefined) Reflect.deleteProperty(globalThis, key);
			else Reflect.set(globalThis, key, value);
		}
		saved.clear();
		for (let g of gates.values()) g.resolve();
		gates.clear();
		log = [];
		await win?.happyDOM.close();
	});

	test('loads new stylesheets before the view transition starts', async () => {
		await boot();
		let b = go('/b/');
		await Bun.sleep(10);
		expect(log).toEqual([]);
		expect(heading()).toBe('A');
		expect(sheets()).toEqual([ '/core.css', '/b.css pending' ]);

		load('/b.css');
		await b.done;
		expect(log).toEqual([ '/core.css /b.css off' ]);
		expect(heading()).toBe('B');
		expect(sheets()).toEqual([ '/core.css', '/b.css' ]);
		expect(document.head.querySelector('style[data-bongo-preset]')).not.toBeNull();
	});

	test('a superseded navigation leaves no stray stylesheets', async () => {
		await boot();
		let b = go('/b/');
		await Bun.sleep(10);
		b.abort();
		let c = go('/c/');
		load('/c.css');
		await Promise.all([ b.done, c.done ]);
		expect(log).toEqual([ '/core.css /c.css off' ]);
		expect(heading()).toBe('C');
		expect(sheets()).toEqual([ '/core.css', '/c.css' ]);

		load('/b.css');
		await Bun.sleep(10);
		expect(sheets()).toEqual([ '/core.css', '/c.css' ]);
	});

	test('back and forward swap stylesheets the same way', async () => {
		await boot();
		load('/b.css');
		await go('/b/').done;
		await go('/', 'traverse').done;
		expect(heading()).toBe('A');
		expect(sheets()).toEqual([ '/core.css' ]);

		await go('/b/', 'traverse').done;
		expect(heading()).toBe('B');
		expect(sheets()).toEqual([ '/core.css', '/b.css' ]);
		expect(log).toEqual([
			'/core.css /b.css off',
			'/core.css /b.css',
			'/core.css /b.css off',
		]);
	});

	test('announces each new title in one live region that outlives the swaps', async () => {
		await boot();
		let live = document.getElementById('bongo:live');
		expect(live?.parentElement).toBe(document.body);
		expect(live?.getAttribute('aria-live')).toBe('polite');
		expect(document.head.querySelector('div')).toBeNull();

		load('/b.css');
		await go('/b/').done;
		expect(document.getElementById('bongo:live')).toBe(live);
		expect(live?.textContent).toBe('B');

		load('/c.css');
		await go('/c/').done;
		expect(document.querySelectorAll('[id="bongo:live"]')).toHaveLength(1);
		expect(document.body.firstElementChild).toBe(live);
		expect(live?.textContent).toBe('C');

		await go('/', 'traverse').done;
		expect(document.body.firstElementChild).toBe(live);
		expect(live?.textContent).toBe('A');
	});
});
