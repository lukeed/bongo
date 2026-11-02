/// <reference lib="dom" />
import * as preset from './preset';
import * as prefetch from './prefetch';
import * as internal from './internal';
import * as styles from './styles';

import type { Page } from './html';

export { on, off } from './internal';

export type ClientOptions = {
	transitions?: preset.Options;   // `true` aliases 'fade'; falsy disables
	prefetch?: prefetch.Options;    // `true` aliases 'hover'; falsy disables
};

export type BongoEvent =
	| 'bongo:ready'
	| 'bongo:navigate'
	| 'bongo:navigated'
	| 'bongo:replace'
	| 'bongo:replaced'
	| 'bongo:error';

export type BongoEventDetails = {
	'bongo:ready': { url: URL };
	'bongo:navigate': { to: URL; from: URL };
	'bongo:navigated': { to: URL; from: URL };
	'bongo:replace': { to: URL; from: URL; doc: Document };
	'bongo:replaced': { to: URL; from: URL };
	'bongo:error': { to: URL; error: Error };
};

export function client(opts: ClientOptions = {}): void {
	let nav: Navigation | undefined = globalThis.navigation;
	internal.emit('bongo:ready', { url: new URL(location.href) });

	// Prefetch works independently of the Navigation API — even on MPA
	// fallback, warming the HTTP cache speeds up the next full-page load.
	prefetch.install(prefetch.resolve(opts.prefetch));

	if (!nav) return; // MPA fallback — no interception

	styles.adopt(document);
	internal.track(nav);

	// Take over scroll restoration from the browser so we can do it synchronously.
	if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

	let name = preset.resolve(opts.transitions);

	// Inject preset CSS if applicable (requires browser document).
	if (name) preset.inject(name);

	// Add the live region up front, so it is in the accessibility tree before its first update.
	internal.announcer();

	// Capture-phase click listener: sets BYPASS_NEXT for browsers that don't
	// expose NavigateEvent.sourceElement.
	document.addEventListener('click', (e) => {
		let target = e.target as Element | null;
		let anchor = target?.closest?.('a[transition\\:disable]');
		internal.setBypassNext(!!anchor);
	}, true);

	nav.addEventListener('navigate', (event) => {
		if (!internal.shouldIntercept(event)) return;

		let from = new URL(location.href);
		let to = new URL(event.destination.url);

		// Remember scroll for the page we are leaving, so back/forward can restore it.
		internal.rememberScroll(from);

		// a newer navigation aborts this one; it must not touch the page after that
		let { signal } = event;
		let page: Promise<Page | undefined> | undefined;

		function load(): Promise<Page | undefined> {
			internal.emit('bongo:navigate', { to, from });
			return internal.fetchPage(to, signal);
		}

		function fail(err: unknown): never {
			if (!signal.aborted) internal.emit('bongo:error', { to, error: err instanceof Error ? err : new Error(String(err)) });
			throw err;
		}

		// Before the URL commits, a redirect can still change it, so the address bar and relative URLs match the page.
		let precommit = event.navigationType !== 'traverse' && typeof globalThis.NavigationPrecommitController === 'function';

		event.intercept({
			...(precommit && {
				async precommitHandler(controller: NavigationPrecommitController) {
					try {
						let found = await (page = load());
						if (found && found.url.href !== to.href && !signal.aborted) controller.redirect(found.url.href);
					} catch (err) {
						fail(err);
					}
				},
			}),
			async handler() {
				try {
					let found = await (page ??= load());
					if (signal.aborted) return;
					// a file of another type, such as a feed: the browser shows it, as it would without bongo
					if (found === undefined) {
						internal.setBypassNext(true);
						return location.replace(to.href);
					}
					if (found.url.href !== to.href) {
						// a redirect that came too late to change the URL: load its page, so that the URL matches
						if (!precommit) {
							internal.setBypassNext(true);
							return location.replace(found.url.href);
						}
						to = found.url;
					}
					let doc = new DOMParser().parseFromString(found.html, 'text/html');
					internal.emit('bongo:replace', { to, from, doc });

					let staged = styles.stage(document, doc, signal);
					try {
						await staged.ready;
						if (signal.aborted) return;
						await internal.transition(!!name, () => {
							if (signal.aborted) return;
							staged.commit();
							internal.reconcile(document, doc);
							internal.rendered();
							// alert('before scroll')
							internal.restoreScroll(event, to);
							// event.scroll?.();
							internal.emit('bongo:replaced', { to, from });
						});
					} finally {
						staged.drop();
					}
					if (signal.aborted) return;

					// Announcer lives in <body> and survives each swap; resolve it here in case
					// client() started before <body> existed.
					let announcer = internal.announcer();
					if (announcer) announcer.textContent = document.title;
					internal.emit('bongo:navigated', { to, from });
				} catch (err) {
					if (signal.aborted) return;
					fail(err);
				}
			},
		});
	});
}

export async function navigate(url: string | URL, opts: { replace?: boolean } = {}): Promise<void> {
	let target = new URL(url, location.href);
	let nav = globalThis.navigation;
	if (nav) {
		let { committed, finished } = nav.navigate(target.href, {
			history: opts.replace ? 'replace' : 'push'
		});
		committed?.catch(() => {});
		try {
			await finished;
		} catch (err) {
			// superseded by a newer navigation; the last one wins
			if (err instanceof DOMException && err.name === 'AbortError') return;
			throw err;
		}
		return;
	}
	location[ opts.replace ? 'replace' : 'assign' ](target.href);
}
