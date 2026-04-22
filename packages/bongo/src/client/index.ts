/// <reference lib="dom" />
import * as preset from './preset';
import * as internal from './internal';

export { on, off } from './internal';

export type ClientOptions = {
	transitions?: preset.Options;  // `true` aliases 'fade', `false` aliases 'none'
	announce?: boolean;
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

	if (!nav) return; // MPA fallback — no interception

	// Take over scroll restoration from the browser so we can do it synchronously.
	if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

	let name = preset.resolve(opts.transitions);

	// Inject preset CSS if applicable (requires browser document).
	if (name !== 'none') preset.inject(name);

	let announcer = opts.announce ? internal.ensureAnnouncer() : null;

	// Capture-phase click listener: sets BYPASS_NEXT for browsers that don't
	// expose NavigateEvent.sourceElement.
	document.addEventListener('click', (e) => {
		let target = e.target as Element | null;
		let anchor = target?.closest?.('a[bongo-reload]');
		internal.setBypassNext(!!anchor);
	}, true);

	nav.addEventListener('navigate', (event) => {
		if (!internal.shouldIntercept(event)) return;

		let from = new URL(location.href);
		let to = new URL(event.destination.url);

		// Remember scroll for the page we are leaving, so back/forward can restore it.
		internal.rememberScroll(from);

		event.intercept({
			async handler() {
				try {
					internal.emit('bongo:navigate', { to, from });
					let html = await internal.fetchPage(to);
					let doc = new DOMParser().parseFromString(html, 'text/html');
					internal.emit('bongo:replace', { to, from, doc });

					let swap = () => {
						internal.reconcile(document, doc);
						// alert('before scroll')
						internal.restoreScroll(event, to);
						// event.scroll?.();
						internal.emit('bongo:replaced', { to, from });
					};

					let viewTransition = document.startViewTransition
					if (name !== 'none' && viewTransition) {
						await viewTransition.call(document, swap).finished;
					} else {
						swap();
					}

					if (announcer) announcer.textContent = document.title;
					internal.emit('bongo:navigated', { to, from });
				} catch (err) {
					internal.emit('bongo:error', { to, error: err instanceof Error ? err : new Error(String(err)) });
					throw err;
				}
			},
		});
	});
}

export async function navigate(url: string | URL, opts: { replace?: boolean } = {}): Promise<void> {
	let target = new URL(url, location.href);
	let nav = globalThis.navigation;
	if (nav) {
		await nav.navigate(target.href, {
			history: opts.replace ? 'replace' : 'push'
		}).finished;
		return;
	}
	location[ opts.replace ? 'replace' : 'assign' ](target.href);
}
