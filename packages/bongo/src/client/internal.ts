/// <reference lib="dom" />
import * as html from './html';
import * as prefetch from './prefetch';
import type { BongoEvent, BongoEventDetails } from './index';

type Handler<K extends BongoEvent> = (detail: BongoEventDetails[ K ]) => void;

const LISTENERS = new Map<BongoEvent, Set<Handler<BongoEvent>>>();

const LIVE = 'bongo:live';
const PERSIST = '[transition\\:persist]';

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
	if (BYPASS_NEXT) return BYPASS_NEXT = false;
	if (!event.canIntercept || event.hashChange) return false;
	if (event.navigationType === 'reload') return false;
	if (event.downloadRequest) return false;

	let url = new URL(event.destination.url);
	if (url.origin !== location.origin) return false;
	if (!html.page(url)) return false;

	if (event.sourceElement?.hasAttribute('transition:disable')) {
		return false;
	}

	return true;
}

export async function fetchPage(url: URL, signal?: AbortSignal): Promise<string | undefined> {
	let cached = prefetch.get(url.href);
	if (cached) {
		try { return await cached; }
		catch { /* prefetch failed — fall through to a fresh fetch */ }
	}
	let res = await fetch(url.href, { headers: { Accept: 'text/html' }, signal });
	if (!res.ok) throw new Error(`Navigation fetch failed: ${res.status} ${res.statusText}`);
	return html.read(res);
}

// The key of a `transition:persist` element: the attribute's value, or else its id.
function persists(doc: Document): Map<string, Element> {
	let out = new Map<string, Element>();
	for (let el of doc.querySelectorAll(PERSIST)) {
		let key = el.getAttribute('transition:persist') || el.id;
		if (key) out.set(key, el);
	}
	return out;
}

export function reconcile(current: Document, incoming: Document): void {
	current.title = incoming.title;

	// Each `transition:persist` element moves into the new body in place of its copy, so it keeps its state.
	// Moving an element resets its scroll, so it is put back after the swap.
	let kept = persists(current);
	let focus = current.activeElement;
	let moved: { el: Element; top: number; left: number }[] = [];
	for (let [key, copy] of persists(incoming)) {
		let el = kept.get(key);
		if (!el) continue;
		moved.push({ el, top: el.scrollTop, left: el.scrollLeft });
		copy.replaceWith(el);
	}

	// Body swap, keeping the one live region so screen readers keep tracking it.
	let live = current.getElementById(LIVE);
	incoming.getElementById(LIVE)?.remove();
	current.body.replaceWith(incoming.body);
	if (live) current.body.prepend(live);

	for (let { el, top, left } of moved) {
		el.scrollTop = top;
		el.scrollLeft = left;
	}
	let view = current.defaultView;
	if (view && focus instanceof view.HTMLElement && focus !== current.activeElement && moved.some(({ el }) => el.contains(focus))) {
		focus.focus({ preventScroll: true });
	}
}

/**
 * Run `swap` inside a view transition when enabled and supported.
 * A skipped transition (eg, interrupted by a newer one) still swaps and never rejects;
 * only a failing `swap` rejects.
 */
export async function transition(enabled: boolean, swap: () => void): Promise<void> {
	let start = enabled && document.startViewTransition;
	if (!start) return swap();
	let vt = start.call(document, swap);
	vt.ready.catch(() => {});
	vt.finished.catch(() => {});
	await vt.updateCallbackDone;
	await vt.finished;
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

/**
 * Find the aria-live region that announces each new page title, or add it to `<body>`.
 *
 * @example
 * let live = announcer();
 * if (live) live.textContent = document.title;
 */
export function announcer(): HTMLElement | undefined {
	let el = document.getElementById(LIVE);
	if (el || !document.body) return el ?? undefined;
	el = document.createElement('div');
	el.id = LIVE;
	el.setAttribute('role', 'status');
	el.setAttribute('aria-live', 'polite');
	el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0';
	document.body.prepend(el);
	return el;
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
