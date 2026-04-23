/// <reference lib="dom" />
import * as prefetch from './prefetch';
import type { BongoEvent, BongoEventDetails } from './index';

type Handler<K extends BongoEvent> = (detail: BongoEventDetails[ K ]) => void;

const LISTENERS = new Map<BongoEvent, Set<Handler<BongoEvent>>>();

// Fallback flag for browsers that don't expose NavigateEvent.sourceElement.
let BYPASS_NEXT = false;

// In-session scroll memory, keyed by full URL. Populated on navigate-out
// and read on back/forward. Synchronous restore avoids the async `event.scroll()`
// jump where the browser paints the new body at the old scroll first.
const SCROLL_CACHE = new Map<string, { x: number; y: number }>();

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

export function shouldIntercept(event: NavigateEvent): boolean {
	if (BYPASS_NEXT) {
		BYPASS_NEXT = false;
		return false;
	}
	if (event.sourceElement?.hasAttribute('transition:disable')) return false;
	if (!event.canIntercept) return false;
	if (event.hashChange) return false;
	if (event.downloadRequest !== null) return false;
	let url = new URL(event.destination.url);
	if (url.origin !== location.origin) return false;
	return true;
}

export async function fetchPage(url: URL): Promise<string> {
	let cached = prefetch.get(url.href);
	if (cached) {
		try { return await cached; }
		catch { /* prefetch failed — fall through to a fresh fetch */ }
	}
	let res = await fetch(url.href, { headers: { Accept: 'text/html' } });
	if (!res.ok) throw new Error(`Navigation fetch failed: ${res.status} ${res.statusText}`);
	return res.text();
}

function stylesheets(doc: Document): HTMLLinkElement[] {
	return [ ...doc.querySelectorAll('link[rel=stylesheet]') ] as HTMLLinkElement[];
}

export function reconcile(current: Document, incoming: Document): void {
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

export function rememberScroll(url: URL): void {
	SCROLL_CACHE.set(url.href, { x: window.scrollX, y: window.scrollY });
}

export function restoreScroll(event: NavigateEvent, to: URL): void {
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

export function announcer(): HTMLElement | null {
	return document.getElementById('bongo:live');
}

/** @internal — used by tests only */
export function reset(): void {
	LISTENERS.clear();
	SCROLL_CACHE.clear();
	BYPASS_NEXT = false;
}

/** @internal — used by tests only */
export function getBypassNext(): boolean {
	return BYPASS_NEXT;
}

/** @internal — used by tests only and the transition:disable click capture in client() */
export function setBypassNext(val: boolean): void {
	BYPASS_NEXT = val;
}
