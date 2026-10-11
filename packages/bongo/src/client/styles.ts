/// <reference lib="dom" />

type Sheet = HTMLLinkElement | HTMLStyleElement;

export type Stage = {
	/** Settles once each staged sheet loads or fails, after 3s, or when the navigation aborts. */
	ready: Promise<void>;
	/** Apply the staged sheets and remove the ones the new page does not use. */
	commit(): void;
	/** Remove the staged sheets that were never committed. */
	drop(): void;
};

// Page-owned sheets, keyed when added, so a relative href keeps the URL it had then.
const OWNED = new WeakMap<Element, string>();

// Longest wait for new stylesheets; navigation never hangs on a slow sheet.
const TIMEOUT = 3_000;

function sheets(doc: Document): Sheet[] {
	let all = doc.head.querySelectorAll<Sheet>('link[rel~=stylesheet], style');
	return [ ...all ].filter(el => !el.closest('noscript'));
}

function key(el: Sheet): string {
	let source = 'href' in el ? el.href : el.textContent;
	return JSON.stringify([ el.localName, source, el.media, el.hasAttribute('disabled') ]);
}

function applies(el: Sheet, view: Window | null): boolean {
	if (el.hasAttribute('disabled')) return false;
	if ('href' in el && !el.getAttribute('href')) return false;
	return !el.media || !view || view.matchMedia(el.media).matches;
}

/**
 * Mark the stylesheets in `doc` as page-owned, so navigations may keep or remove them.
 * Sheets that scripts add later are never touched.
 *
 * @example
 * styles.adopt(document);
 */
export function adopt(doc: Document): void {
	for (let el of sheets(doc)) OWNED.set(el, key(el));
}

/**
 * Load the `<head>` stylesheets of `incoming` that `current` lacks, without applying them.
 * Each new sheet stays disabled and the current ones stay active until `commit()`,
 * so the outgoing page never restyles.
 *
 * @example
 * let stage = styles.stage(document, doc, signal);
 * try {
 *   await stage.ready;
 *   stage.commit();
 *   document.body.replaceWith(doc.body);
 * } finally {
 *   stage.drop();
 * }
 */
export function stage(current: Document, incoming: Document, signal: AbortSignal): Stage {
	let view = current.defaultView;
	let owned = sheets(current).filter(el => OWNED.has(el));
	let kept = new Set<Sheet>();
	let added: { el: Sheet; id: string }[] = [];
	let paused: CSSStyleSheet[] = [];
	let loads: Promise<void>[] = [];
	let at = -1;
	let frame = 0;
	let prev: Sheet | undefined;

	// Disable each new sheet as it appears: from cache, on load, or before the next frame renders.
	let pause = () => {
		for (let { el } of added) {
			let sheet = el.sheet;
			if (!sheet || sheet.disabled) continue;
			sheet.disabled = true;
			paused.push(sheet);
		}
	};
	let watch = () => {
		pause();
		frame = view?.requestAnimationFrame(watch) ?? 0;
	};

	for (let next of sheets(incoming)) {
		let id = key(next);
		let i = owned.findIndex((el, j) => j > at && OWNED.get(el) === id);
		if (i !== -1) {
			kept.add(prev = owned[ i ]);
			at = i;
			continue;
		}

		let el = current.importNode(next, true);
		added.push({ el, id });
		if (applies(next, view)) {
			loads.push(new Promise<void>(resolve => {
				el.addEventListener('load', () => resolve(), { once: true });
				el.addEventListener('error', () => resolve(), { once: true });
			}).then(pause));
		}

		if (prev) prev.after(el);
		else if (owned.length) owned[ 0 ].before(el);
		else current.head.append(el);
		prev = el;
	}

	if (added.length) watch();

	let ready = new Promise<void>(resolve => {
		if (!loads.length || signal.aborted) return resolve();
		let timer = setTimeout(done, TIMEOUT);
		signal.addEventListener('abort', done);
		Promise.all(loads).then(done);

		function done() {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
	});

	return {
		ready,
		commit() {
			view?.cancelAnimationFrame(frame);
			for (let sheet of paused) sheet.disabled = false;
			for (let { el, id } of added) OWNED.set(el, id);
			for (let el of owned) {
				if (kept.has(el)) continue;
				OWNED.delete(el);
				el.remove();
			}
			added = [];
		},
		drop() {
			view?.cancelAnimationFrame(frame);
			for (let { el } of added) el.remove();
			added = [];
		},
	};
}

/**
 * List the same-origin stylesheet URLs that `incoming` would apply and `current` lacks.
 * Relative hrefs resolve against `base`, the URL that `incoming` came from.
 *
 * @example
 * let doc = new DOMParser().parseFromString(html, 'text/html');
 * for (let url of styles.missing(document, doc, '/about/')) fetch(url);
 */
export function missing(current: Document, incoming: Document, base: string): string[] {
	let origin = new URL(base).origin;
	let have = new Set(sheets(current).map(el => 'href' in el ? el.href : ''));
	let urls = new Set<string>();

	for (let el of sheets(incoming)) {
		if (!('href' in el) || !applies(el, current.defaultView)) continue;
		try {
			var url = new URL(el.getAttribute('href') || '', base);
		} catch {
			continue;
		}
		if (url.origin === origin && !have.has(url.href)) urls.add(url.href);
	}

	return [ ...urls ];
}
