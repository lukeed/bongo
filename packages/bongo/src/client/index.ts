/// <reference lib="dom" />
import { resolvePreset, injectPresetCSS, type TransitionPreset, type TransitionOption } from './transitions';

export type { TransitionPreset } from './transitions';

export type ClientOptions = {
	transitions?: TransitionOption;  // `true` aliases 'fade', `false` aliases 'none'
	announce?: boolean;
};

export type BongoEvent =
	| 'bongo:ready'
	| 'bongo:nav:before'
	| 'bongo:nav:after'
	| 'bongo:swap:before'
	| 'bongo:swap:after'
	| 'bongo:error';

export type BongoEventDetails = {
	'bongo:ready': { url: URL };
	'bongo:nav:before': { to: URL; from: URL };
	'bongo:nav:after': { to: URL; from: URL };
	'bongo:swap:before': { to: URL; from: URL; doc: Document };
	'bongo:swap:after': { to: URL; from: URL };
	'bongo:error': { to: URL; error: Error };
};

type Handler<K extends BongoEvent> = (detail: BongoEventDetails[ K ]) => void;

// Module-level listener registry; reset() is exported for test isolation.
let LISTENERS: Map<BongoEvent, Set<Handler<BongoEvent>>> = new Map();

// Fallback flag for browsers that don't expose NavigateEvent.sourceElement.
let BYPASS_NEXT = false;

// In-session scroll memory, keyed by full URL. Populated on navigate-out
// and read on back/forward. Synchronous restore avoids the async `event.scroll()`
// jump where the browser paints the new body at the old scroll first.
let SCROLL_CACHE = new Map<string, { x: number; y: number }>();

/** @internal — used by tests only */
export function reset(): void {
	LISTENERS = new Map();
	BYPASS_NEXT = false;
	SCROLL_CACHE = new Map();
}

/** @internal — used by tests only */
export function emit<K extends BongoEvent>(type: K, detail: BongoEventDetails[ K ]): void {
	let set = LISTENERS.get(type);
	if (!set) return;
	for (let fn of set) {
		try { fn(detail as BongoEventDetails[ BongoEvent ]); }
		catch (err) { console.error(`[bongo] handler for ${type} threw:`, err); }
	}
}

export function on<K extends BongoEvent>(type: K, handler: Handler<K>): () => void {
	let set = LISTENERS.get(type);
	if (!set) LISTENERS.set(type, set = new Set());

	set.add(handler as Handler<BongoEvent>);
	return () => set.delete(handler as Handler<BongoEvent>);
}

export function off<K extends BongoEvent>(type: K, handler: Handler<K>): void {
	LISTENERS.get(type)?.delete(handler as Handler<BongoEvent>);
}


function shouldIntercept(event: NavigateEvent): boolean {
	if (BYPASS_NEXT) {
		BYPASS_NEXT = false;
		return false;
	}
	if (event.sourceElement?.hasAttribute('bongo-reload')) return false;
	if (!event.canIntercept) return false;
	if (event.hashChange) return false;
	if (event.downloadRequest !== null) return false;
	let url = new URL(event.destination.url);
	if (url.origin !== location.origin) return false;
	return true;
}

async function fetchPage(url: URL): Promise<string> {
	let res = await fetch(url.href, { headers: { Accept: 'text/html' } });
	if (!res.ok) throw new Error(`Navigation fetch failed: ${res.status} ${res.statusText}`);
	return res.text();
}

function stylesheets(doc: Document): HTMLLinkElement[] {
	return [ ...doc.querySelectorAll('link[rel=stylesheet]') ] as HTMLLinkElement[];
}

function reconcile(current: Document, incoming: Document): void {
	current.title = incoming.title;

	// Diff <link rel="stylesheet"> by href.
	let currentLinks = stylesheets(current);
	let incomingLinks = stylesheets(incoming);
	let curHrefs = new Set(currentLinks.map(l => l.href));
	let incHrefs = new Set(incomingLinks.map(l => l.href));

	for (let l of incomingLinks) {
		curHrefs.has(l.href) || current.head.appendChild(l.cloneNode(true));
	}
	for (let l of currentLinks) {
		incHrefs.has(l.href) || l.remove();
	}

	// Body swap.
	current.body.replaceWith(incoming.body);
}

function restoreScroll(event: NavigateEvent, to: URL): void {
	// Traversal (back/forward): restore from our synchronous cache.
	if (event.navigationType === 'traverse') {
		let saved = SCROLL_CACHE.get(to.href);
		if (saved) {
			window.scrollTo(saved.x, saved.y);
			return;
		}
		window.scrollTo(0, 0);
		return;
	}
	// push/replace: scroll to hash target, else top.
	if (to.hash) {
		let id = decodeURIComponent(to.hash.slice(1));
		let target = id && document.getElementById(id);
		if (target) {
			target.scrollIntoView();
			return;
		}
	}
	window.scrollTo(0, 0);
}

function ensureAnnouncer(): HTMLElement {
	let el = document.getElementById('__bongo-live__');
	if (el) return el;
	el = document.createElement('div');
	el.id = '__bongo-live__';
	el.setAttribute('role', 'status');
	el.setAttribute('aria-live', 'polite');
	el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0';
	document.body.appendChild(el);
	return el;
}

export function client(opts: ClientOptions = {}): void {
	let nav: Navigation | undefined = globalThis.navigation;
	emit('bongo:ready', { url: new URL(location.href) });

	if (!nav) return; // MPA fallback — no interception

	// Take over scroll restoration from the browser so we can do it synchronously.
	if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

	let preset = resolvePreset(opts.transitions);

	// Inject preset CSS if applicable (requires browser document).
	if (preset !== 'none') injectPresetCSS(preset);

	let announcer = opts.announce ? ensureAnnouncer() : null;

	// Capture-phase click listener: sets BYPASS_NEXT for browsers that don't
	// expose NavigateEvent.sourceElement.
	document.addEventListener('click', (e) => {
		let target = e.target as Element | null;
		let anchor = target?.closest?.('a[bongo-reload]');
		BYPASS_NEXT = !!anchor;
	}, true);

	nav.addEventListener('navigate', (event) => {
		if (!shouldIntercept(event)) return;

		let from = new URL(location.href);
		let to = new URL(event.destination.url);

		// Remember scroll for the page we are leaving, so back/forward can restore it.
		SCROLL_CACHE.set(from.href, { x: window.scrollX, y: window.scrollY });

		event.intercept({
			async handler() {
				try {
					emit('bongo:nav:before', { to, from });
					let html = await fetchPage(to);
					let doc = new DOMParser().parseFromString(html, 'text/html');
					emit('bongo:swap:before', { to, from, doc });

					let swap = () => {
						reconcile(document, doc);
						// alert('before scroll')
						restoreScroll(event, to);
						// event.scroll?.();
						emit('bongo:swap:after', { to, from });
					};

					let viewTransition = document.startViewTransition
					if (preset !== 'none' && viewTransition) {
						await viewTransition.call(document, swap).finished;
					} else {
						swap();
					}

					if (announcer) announcer.textContent = document.title;
					emit('bongo:nav:after', { to, from });
				} catch (err) {
					emit('bongo:error', { to, error: err instanceof Error ? err : new Error(String(err)) });
					throw err;
				}
			},
		});
	});
}

export function navigate(url: string | URL, opts: { replace?: boolean } = {}): Promise<void> {
	let target = new URL(url, location.href);
	let nav = globalThis.navigation;
	if (!nav) {
		location[ opts.replace ? 'replace' : 'assign' ](target.href);
		return Promise.resolve();
	}
	let result = nav.navigate(target.href, {
		history: opts.replace ? 'replace' : 'push'
	});
	return result.finished;
}

/** @internal — used by tests only */
export function getBypassNext(): boolean {
	return BYPASS_NEXT;
}

/** @internal — used by tests only */
export function setBypassNext(val: boolean): void {
	BYPASS_NEXT = val;
}
