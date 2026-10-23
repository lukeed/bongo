/// <reference lib="dom" />

export type ClientOptions = {
	/** View transitions between pages: `true` is `'fade'`, a falsy value turns them off. */
	transitions?: boolean | 'fade' | 'initial' | 'slide' | (string & {});
	/** Fetch a page before its link is clicked: `true` is `'hover'`, a falsy value turns it off. */
	prefetch?: boolean | 'hover' | 'tap';
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

/**
 * Start client navigation: links load in place, with view transitions and prefetch.
 * @example client({ transitions: 'slide', prefetch: 'tap' });
 */
export function client(opts?: ClientOptions): void;

/**
 * Go to `url` as a click on a link does. Resolves when the new page is in place.
 * @example await navigate('/blog/', { replace: true });
 */
export function navigate(url: string | URL, opts?: { replace?: boolean }): Promise<void>;

/**
 * Call `handler` on each `type` event. Returns a function that removes it.
 * @example let stop = on('bongo:navigated', ({ to }) => console.log(to.pathname));
 */
export function on<K extends BongoEvent>(type: K, handler: (detail: BongoEventDetails[K]) => void): () => void;

/**
 * Remove a handler that `on()` added.
 * @example off('bongo:navigated', handler);
 */
export function off<K extends BongoEvent>(type: K, handler: (detail: BongoEventDetails[K]) => void): void;
