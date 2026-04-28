import type { Config, Feed as CoreFeed, Template } from 'bongo';

export namespace Feed {
	export type Format = CoreFeed.Format;
	export type Item = CoreFeed.Item;
	export type Link = CoreFeed.Link;

	// Arguments accepted by the `feed` tempura block. The block is normally
	// invoked via the `<bongo:feed .../>` rewrite, which forwards every
	// attribute as a tempura JS expression. `items` therefore receives the
	// caller's runtime variable (e.g. `{{#var posts}}…{{/var}}`) — not an
	// HTML string.
	export type TagArgs = {
		format?: Format;
		title?: string;
		description?: string;
		// Items default to PageInfo[] (run through the plugin's defaultRender).
		// Accept Item[] too so callers can pre-shape their items.
		items?: Template.PageInfo[] | Item[];
		// Output URL — defaults to the surrounding `$page.url` so the rendered
		// XML can self-reference. Pass explicitly when invoking outside of a
		// content page.
		url?: string;
		// Per-item mapper. When omitted, falls back to the plugin's
		// defaultRender (title / url / summary / date from PageInfo).
		render?: (page: Template.PageInfo) => Item;
	};

	// Per-feed registration parsed out of a content file's front-matter.
	// Used by the `pages` hook to attach `<link rel="alternate">` entries to
	// every page whose path matches `attach`.
	export type Registration = {
		// Site-absolute URL path (e.g. `/blog/feed.xml`). Read from `output:`.
		path: string;
		title: string;
		format: Format;
		// Path-prefix or predicate. Strings are turned into a `startsWith`
		// match (with a guaranteed trailing `/`).
		attach: string | ((page: Template.PageInfo) => boolean);
	};
}

// Plugin factory. Add to `bongo.config.ts`'s `plugins` array — registers
// the `feed` tempura block (so `<bongo:feed .../>` works inside content)
// and a `pages` hook that walks every content file's front-matter for
// `attach:` markers and decorates matching pages with `feeds: [...]` so
// layouts can render `<link rel="alternate">` elements.
export function feed(): Partial<Config>;
