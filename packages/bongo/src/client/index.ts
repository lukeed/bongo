export type TransitionPreset = 'fade' | 'initial' | 'slide' | 'none';

export type ClientOptions = {
	transitions?: boolean | TransitionPreset | string;  // `true` aliases 'fade', `false` aliases 'none'
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

type Handler<K extends BongoEvent> = (detail: BongoEventDetails[K]) => void;

// Module-level listener registry; reset() is exported for test isolation.
let LISTENERS: Map<BongoEvent, Set<Handler<BongoEvent>>> = new Map();

// Fallback flag for browsers that don't expose NavigateEvent.sourceElement.
let BYPASS_NEXT = false;

/** @internal — used by tests only */
export function reset(): void {
	LISTENERS = new Map();
	BYPASS_NEXT = false;
}

/** @internal — used by tests only */
export function emit<K extends BongoEvent>(type: K, detail: BongoEventDetails[K]): void {
	let set = LISTENERS.get(type);
	if (!set) return;
	for (let fn of set) {
		try { fn(detail as BongoEventDetails[BongoEvent]); }
		catch (err) { console.error(`[bongo] handler for ${type} threw:`, err); }
	}
}

export function on<K extends BongoEvent>(type: K, handler: Handler<K>): () => void {
	let set = LISTENERS.get(type);
	if (!set) { set = new Set(); LISTENERS.set(type, set); }
	set.add(handler as Handler<BongoEvent>);
	return () => set!.delete(handler as Handler<BongoEvent>);
}

export function off<K extends BongoEvent>(type: K, handler: Handler<K>): void {
	LISTENERS.get(type)?.delete(handler as Handler<BongoEvent>);
}

// --- Navigation API type stubs (browser-only; not from @types/node) ---

type NavigationApi = {
	addEventListener(type: 'navigate', handler: (event: NavEvent) => void): void;
	navigate(url: string, init?: { history?: 'replace' | 'push' }): { finished: Promise<void> };
};

type NavEvent = {
	destination: { url: string };
	canIntercept: boolean;
	hashChange: boolean;
	downloadRequest: string | null;
	sourceElement?: Element | null;
	intercept(init: { handler: () => Promise<void> | void }): void;
};

// --- View-transition preset CSS ---

const PRESET_CSS: Record<string, string> = {
	fade: [
		'@keyframes bongo-fade-in{from{opacity:0}to{opacity:1}}',
		'@keyframes bongo-fade-out{from{opacity:1}to{opacity:0}}',
		'::view-transition-old(root){animation-name:bongo-fade-out;animation-duration:.18s}',
		'::view-transition-new(root){animation-name:bongo-fade-in;animation-duration:.18s}',
	].join(''),
	slide: [
		'@keyframes bongo-slide-in{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}',
		'@keyframes bongo-slide-out{from{transform:none;opacity:1}to{transform:translateX(-16px);opacity:0}}',
		'::view-transition-old(root){animation-name:bongo-slide-out;animation-duration:.22s}',
		'::view-transition-new(root){animation-name:bongo-slide-in;animation-duration:.22s}',
	].join(''),
};

/** @internal — used by tests only */
export function resolvePreset(opt: ClientOptions['transitions']): string {
	if (opt === true) return 'fade';
	if (!opt || opt === false || opt === 'none') return 'none';
	return opt; // 'fade' | 'initial' | 'slide' | any custom string
}

function injectPresetCSS(preset: string): void {
	let css = PRESET_CSS[preset];
	if (!css) return; // 'initial', 'none', or unknown custom preset — user handles CSS
	// Only inject once per preset name.
	if (document.querySelector(`style[data-bongo-preset="${preset}"]`)) return;
	let el = document.createElement('style');
	el.setAttribute('data-bongo-preset', preset);
	el.textContent = css;
	document.head.appendChild(el);
}

function shouldIntercept(event: NavEvent): boolean {
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

function reconcile(current: Document, incoming: Document): void {
	// Title
	current.title = incoming.title;

	// Stylesheets: diff <link rel="stylesheet"> by href.
	let hrefs = (doc: Document) =>
		new Set(Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(l => (l as HTMLLinkElement).href));
	let cur = hrefs(current);
	let inc = hrefs(incoming);

	// Add incoming links the current page doesn't have.
	for (let link of Array.from(incoming.querySelectorAll('link[rel="stylesheet"]'))) {
		let l = link as HTMLLinkElement;
		if (!cur.has(l.href)) current.head.appendChild(l.cloneNode(true));
	}
	// Remove old links the incoming page dropped.
	for (let link of Array.from(current.querySelectorAll('link[rel="stylesheet"]'))) {
		let l = link as HTMLLinkElement;
		if (!inc.has(l.href)) l.remove();
	}

	// Persist elements marked with data-bongo-persist: transplant by exact attr match.
	let persistSelector = '[data-bongo-persist]';
	let existingPersist = new Map<string, Element>();
	for (let el of Array.from(current.querySelectorAll(persistSelector))) {
		let key = (el as HTMLElement).dataset.bongoPersist;
		if (key) existingPersist.set(key, el);
	}
	for (let target of Array.from(incoming.querySelectorAll(persistSelector))) {
		let key = (target as HTMLElement).dataset.bongoPersist;
		if (!key) continue;
		let live = existingPersist.get(key);
		if (live) target.replaceWith(live);
	}

	// Body swap.
	current.body.replaceWith(incoming.body);
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
	let nav = (globalThis as { navigation?: NavigationApi }).navigation;
	emit('bongo:ready', { url: new URL(location.href) });

	if (!nav) return; // MPA fallback — no interception

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

		event.intercept({
			async handler() {
				try {
					emit('bongo:nav:before', { to, from });
					let html = await fetchPage(to);
					let doc = new DOMParser().parseFromString(html, 'text/html');
					emit('bongo:swap:before', { to, from, doc });

					let swap = () => {
						reconcile(document, doc);
						emit('bongo:swap:after', { to, from });
					};

					let viewTransition = (document as { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition;
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
	let nav = (globalThis as { navigation?: NavigationApi }).navigation;
	if (!nav) {
		location[opts.replace ? 'replace' : 'assign'](target.href);
		return Promise.resolve();
	}
	let result = nav.navigate(target.href, { history: opts.replace ? 'replace' : 'push' });
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
