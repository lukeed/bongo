import type { Config } from 'bongo';

export type Options = {
	// Override the per-feed item cap. Defaults to 50 items per feed.
	limit?: number;
};

export function feed(options?: Options): Partial<Config>;
