/// <reference lib="dom" />

export type Mode = 'hover' | 'tap' | 'off';
export type Options = boolean | Mode | undefined;

// URLs we have already prefetched (or started prefetching).
const CACHE = new Set<string>();

// "Rest" delay in ms before a hover fires. Short enough to feel responsive,
// long enough to skip mouse-overs that pass through in-flight.
const HOVER_DELAY = 80;

/** @internal — used by tests only */
export function resolve(opt: Options): Mode {
	if (opt === true) return 'hover';
	if (!opt) return 'off';
	return opt;
}

function prefetchable(anchor: HTMLAnchorElement | null | undefined): anchor is HTMLAnchorElement {
	if (!anchor || !anchor.href) return false;
	if (anchor.hasAttribute('bongo-reload')) return false;
	if (anchor.getAttribute('prefetch:mode') === 'off') return false;
	let url: URL;
	try { url = new URL(anchor.href); } catch { return false; }
	if (url.origin !== location.origin) return false;
	if (url.href === location.href) return false; // current page
	if (CACHE.has(url.href)) return false;
	return true;
}

function warm(anchor: HTMLAnchorElement): void {
	let href = anchor.href;
	if (CACHE.has(href)) return;
	CACHE.add(href);
	// Populate the HTTP cache; the subsequent navigation's fetch reuses it.
	fetch(href, { headers: { Accept: 'text/html' } })
		.catch(() => { CACHE.delete(href); });
}

export function install(mode: Mode): void {
	if (mode === 'off') return;

	// Mobile: `touchstart` is the only signal of intent for both modes.
	document.addEventListener('touchstart', (e) => {
		let a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
		if (prefetchable(a)) warm(a);
	}, { capture: true, passive: true });

	if (mode === 'tap') {
		// Desktop: trigger as early as possible — before the click actually lands.
		document.addEventListener('mousedown', (e) => {
			let a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
			if (prefetchable(a)) warm(a);
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
				warm(anchor);
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
