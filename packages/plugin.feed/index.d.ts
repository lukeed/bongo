import type { Config, Feed as CoreFeed, Template } from 'bongo';

export namespace Feed {
	export type Format = CoreFeed.Format;

	export type Item = {
		title: string;
		url: string;
		id?: string;
		summary?: string;
		content?: string;
		date?: unknown;
		author?: string;
		[name: string]: unknown;
	};

	export type Config = {
		format?: Format;
		path: string;
		title: string;
		attach: string | ((page: Template.PageInfo) => boolean);
		filter?: (page: Template.PageInfo) => boolean;
		sort?: (pages: Template.PageInfo[]) => Template.PageInfo[];
		render?: (page: Template.PageInfo) => Item;
	};
}

export function feed(feeds: Feed.Config[]): Partial<Config>;
