/// <reference lib="dom" />

export type Mode = 'hover' | 'tap' | 'off';
export type Options = boolean | Mode | undefined;

// In-memory HTML cache, keyed by absolute href. Ownership of the cache lives
// here — relying on the browser's HTTP cache doesn't work for servers that
// don't set Cache-Control (static hosts often don't), so the double request
// would negate the prefetch.
type Entry = { html: Promise<string>; expires: number };
const CACHE = new Map<string, Entry>();

// How long a prefetched entry stays hot. Balances useful hover-before-click
// windows against serving stale HTML on sites that update frequently.
const TTL = 30_000; // 30s

// "Rest" delay in ms before a hover fires. Short enough to feel responsive,
// long enough to skip mouse-overs that pass through in-flight.
const HOVER_DELAY = 80;

/** @internal — used by tests only */
export function resolve(opt: Options): Mode {
	if (opt === true) return 'hover';
	if (!opt) return 'off';
	return opt;
}

/**
 * Retrieve a prefetched HTML body for `href`, or `undefined` if there is no
 * live entry. Called by `internal.fetchPage()` so navigations reuse the body.
 */
export function get(href: string): Promise<string> | undefined {
	let entry = CACHE.get(href);
	if (!entry) return;
	if (Date.now() > entry.expires) {
		CACHE.delete(href);
		return;
	}
	return entry.html;
}

function prefetchable(anchor: HTMLAnchorElement | null | undefined): anchor is HTMLAnchorElement {
	if (!anchor || !anchor.href) return false;
	// Opt-outs: `prefetch:mode="off"` is the dedicated prefetch flag;
	// `bongo-reload` forces a full page load, which throws away our
	// in-memory cache — nothing to gain by warming it.
	if (anchor.getAttribute('prefetch:mode') === 'off') return false;
	if (anchor.hasAttribute('bongo-reload')) return false;
	let url: URL;
	try { url = new URL(anchor.href); } catch { return false; }
	if (url.origin !== location.origin) return false;
	if (url.href === location.href) return false; // current page
	if (get(url.href)) return false;               // already live in the cache
	return true;
}

/** @internal — also called from event handlers below */
export function warm(href: string): void {
	if (get(href)) return;
	let html = fetch(href, { headers: { Accept: 'text/html' } })
		.then(r => {
			if (!r.ok) throw new Error(`prefetch: ${r.status}`);
			return r.text();
		})
		.catch(err => { CACHE.delete(href); throw err; });
	CACHE.set(href, { html, expires: Date.now() + TTL });
}

/** @internal — used by tests only */
export function reset(): void {
	CACHE.clear();
}

export function install(mode: Mode): void {
	if (mode === 'off') return;

	// Mobile: `touchstart` is the only signal of intent for both modes.
	document.addEventListener('touchstart', (e) => {
		let a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
		if (prefetchable(a)) warm(a.href);
	}, { capture: true, passive: true });

	if (mode === 'tap') {
		// Desktop: trigger as early as possible — before the click actually lands.
		document.addEventListener('mousedown', (e) => {
			let a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
			if (prefetchable(a)) warm(a.href);
		}, true);
		return;
	}

	// mode === 'hover': wait for the mouse to rest on the link.
	let pending: { anchor: HTMLAnchorElement; timer: ReturnType<typeof setTimeout> } | null = null;

	document.addEventListener('mouseover', (e) => {
		let a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
		if (pending && pending.anchor !== a) {
			clearTimeout(pending.timer);
			pending = null;
		}
		if (!prefetchable(a) || pending?.anchor === a) return;
		let anchor = a;
		pending = {
			anchor,
			timer: setTimeout(() => {
				warm(anchor.href);
				pending = null;
			}, HOVER_DELAY),
		};
	}, true);

	document.addEventListener('mouseout', (e) => {
		if (!pending) return;
		let related = (e as MouseEvent).relatedTarget as Element | null;
		let next = related?.closest?.('a') as HTMLAnchorElement | null;
		if (pending.anchor !== next) {
			clearTimeout(pending.timer);
			pending = null;
		}
	}, true);
}
