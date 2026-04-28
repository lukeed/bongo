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

type NormalizedFeed = FeedConfig & {
	format: Template.FeedFormat;
	path: string;
	type: string;
	url(site: Template.Site): string;
	attachPage(page: Template.PageInfo): boolean;
};

const MIME: Record<Template.FeedFormat, string> = {
	atom: 'application/atom+xml',
	jsonl: 'application/x-ndjson',
	rss: 'application/rss+xml',
};

function xml(value: unknown): string {
	let input = String(value || '');
	let output = '';
	for (let i=0; i < input.length; i++) {
		let char = input[i];
		switch (char) {
			case '&':
				output += '&amp;';
				break;
			case '<':
				output += '&lt;';
				break;
			case '>':
				output += '&gt;';
				break;
			case '"':
				output += '&quot;';
				break;
			case "'":
				output += '&apos;';
				break;
			default:
				output += char;
		}
	}
	return output;
}

function path(value: string): string {
	return value.startsWith('/') ? value : '/' + value;
}

function prefix(value: string): string {
	let output = path(value);
	return output.endsWith('/') ? output : output + '/';
}

function time(value: unknown): number {
	if (value instanceof Date) {
		let stamp = value.getTime();
		return Number.isFinite(stamp) ? stamp : 0;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		let stamp = new Date(value).getTime();
		return Number.isFinite(stamp) ? stamp : 0;
	}
	return 0;
}

function iso(value: unknown): string {
	let stamp = time(value);
	return new Date(stamp).toISOString();
}

function utc(value: unknown): string {
	let stamp = time(value);
	return new Date(stamp).toUTCString();
}

function defaultSort(pages: Template.PageInfo[]): Template.PageInfo[] {
	return pages.sort((a, b) => time(b.params.date) - time(a.params.date));
}

function defaultRender(page: Template.PageInfo): FeedItem {
	return {
		title: page.title,
		url: page.url,
		summary: page.summary,
		date: page.params.date,
	};
}

function normalize(input: FeedConfig): NormalizedFeed {
	let format = input.format || 'rss';
	let outputPath = path(input.path);
	let attach = input.attach;
	let type = MIME[format];

	if (typeof attach === 'string') {
		let scope = prefix(attach);
		return {
			...input,
			format,
			path: outputPath,
			type,
			url(site) {
				return new URL(outputPath, site.url).href;
			},
			attachPage(page) {
				return page.path.startsWith(scope);
			},
		};
	}

	return {
		...input,
		format,
		path: outputPath,
		type,
		url(site) {
			return new URL(outputPath, site.url).href;
		},
		attachPage: attach,
	};
}

function itemsFor(feed: NormalizedFeed, pages: Template.PageInfo[]): FeedItem[] {
	let render = feed.render || defaultRender;
	let selected = feed.filter ? pages.filter(feed.filter) : pages.slice();
	let sorted = feed.sort ? feed.sort(selected.slice()) : defaultSort(selected.slice());
	return sorted.map(render);
}

function rss(feed: NormalizedFeed, site: Template.Site, items: FeedItem[]): string {
	let feedUrl = feed.url(site);
	let description = site.description || feed.title;
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
	output += '<channel>\n';
	output += `<title>${xml(feed.title)}</title>\n`;
	output += `<link>${xml(site.url)}</link>\n`;
	output += `<description>${xml(description)}</description>\n`;
	output += `<atom:link href="${xml(feedUrl)}" rel="self" type="${feed.type}"/>\n`;

	for (let item of items) {
		let id = item.id || item.url;
		let summary = item.summary || item.content;
		output += '<item>\n';
		output += `<title>${xml(item.title)}</title>\n`;
		output += `<link>${xml(item.url)}</link>\n`;
		output += `<guid>${xml(id)}</guid>\n`;
		if (summary) output += `<description>${xml(summary)}</description>\n`;
		if (item.date) output += `<pubDate>${xml(utc(item.date))}</pubDate>\n`;
		if (item.author) output += `<author>${xml(item.author)}</author>\n`;
		output += '</item>\n';
	}

	output += '</channel>\n';
	output += '</rss>\n';
	return output;
}

function latest(items: FeedItem[]): unknown {
	let winner: unknown = undefined;
	let stamp = 0;
	for (let item of items) {
		let next = time(item.date);
		if (next > stamp) {
			stamp = next;
			winner = item.date;
		}
	}
	return winner;
}

function atom(feed: NormalizedFeed, site: Template.Site, items: FeedItem[]): string {
	let feedUrl = feed.url(site);
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
	output += `<title>${xml(feed.title)}</title>\n`;
	output += `<id>${xml(feedUrl)}</id>\n`;
	output += `<link href="${xml(feedUrl)}" rel="self" type="${feed.type}"/>\n`;
	output += `<link href="${xml(site.url)}"/>\n`;
	output += `<updated>${xml(iso(latest(items)))}</updated>\n`;

	for (let item of items) {
		let id = item.id || item.url;
		let summary = item.summary || item.content;
		output += '<entry>\n';
		output += `<title>${xml(item.title)}</title>\n`;
		output += `<id>${xml(id)}</id>\n`;
		output += `<link href="${xml(item.url)}"/>\n`;
		output += `<updated>${xml(iso(item.date))}</updated>\n`;
		if (summary) output += `<summary>${xml(summary)}</summary>\n`;
		if (item.author) output += `<author><name>${xml(item.author)}</name></author>\n`;
		output += '</entry>\n';
	}

	output += '</feed>\n';
	return output;
}

function jsonl(items: FeedItem[]): string {
	let output = '';
	for (let item of items) {
		output += JSON.stringify(item) + '\n';
	}
	return output;
}

function render(feed: NormalizedFeed, site: Template.Site, items: FeedItem[]): string {
	if (feed.format === 'atom') return atom(feed, site, items);
	if (feed.format === 'jsonl') return jsonl(items);
	return rss(feed, site, items);
}

export function feed(feeds: FeedConfig[]): Partial<Config> {
	let normalized = feeds.map(normalize);

	return {
		$hooks: {
			pages({ config, pages }) {
				for (let page of pages) {
					for (let feed of normalized) {
						if (!feed.attachPage(page)) continue;
						let list = page.feeds || [];
						list.push({
							format: feed.format,
							path: feed.path,
							title: feed.title,
							type: feed.type,
							url: feed.url(config.$site),
						});
						page.feeds = list;
					}
				}
			},
			async output({ config, pages, write }) {
				for (let feed of normalized) {
					let items = itemsFor(feed, pages);
					await write(feed.path, render(feed, config.$site, items));
				}
			},
		},
	};
}
