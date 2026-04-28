import type { Config, Template } from 'bongo';

export type FeedItem = {
	title: string;
	url: string;
	id?: string;
	summary?: string;
	content?: string;
	date?: unknown;
	author?: string;
	[name: string]: unknown;
};

export type FeedConfig = {
	format?: Template.FeedFormat;
	path: string;
	title: string;
	attach: string | ((page: Template.PageInfo) => boolean);
	filter?: (page: Template.PageInfo) => boolean;
	sort?: (pages: Template.PageInfo[]) => Template.PageInfo[];
	render?: (page: Template.PageInfo) => FeedItem;
};

export function feed(feeds: FeedConfig[]): Partial<Config>;
