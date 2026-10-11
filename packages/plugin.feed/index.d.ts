import type { Config } from 'bongo';

export type Format = 'rss' | 'atom';

/**
 * Write RSS or Atom feeds from `<feed:channel>` and `<feed:item>` elements in output files whose
 * frontmatter has `format: rss` or `format: atom`, and turn each `<feed:link path="…" />` in a page
 * into a `<link rel="alternate">` to that feed.
 * @example
 * import { feed } from '@bongo/feed';
 * export default { plugins: [feed()] };
 */
export function feed(): Partial<Config>;
