import * as helpers from './helpers';

import type { Build, Config, Template } from 'bongo';
import type { Format } from './helpers';

export type { Format };

// quoted values may hold `>` and `/>`, which `{{ }}` does not escape
const LINK = /<feed:link\b((?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))*?)\s*\/?>(?:<\/feed:link\s*>)?/g;
const CHANNEL = /<feed:channel\b((?:"[^"]*"|'[^']*'|[^>"'])*?)>([\s\S]*?)<\/feed:channel\s*>/;
const ITEM = /<feed:item\b((?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))*?)\s*\/?>(?:<\/feed:item\s*>)?/g;

const LINK_ATTRS = ['path', 'title'];
const ITEM_ATTRS = ['href', 'title', 'date', 'summary', 'content', 'id', 'author', 'tags'];
const REQUIRED = ['href', 'title', 'date'];

type Item = {
	href: string;
	title: string;
	date: string;
	summary: string;
	content: string;
	id: string;
	author: string;
	tags: string[];
};

type Channel = {
	title: string;
	description: string;
	subtitle: string;
	language: string;
	copyright: string;
	self: string;
	site: string;
};

// frontmatter is typed, so `title: 2024` is a number
function text(value: unknown): string {
	let type = typeof value;
	return type === 'string' || type === 'number' || type === 'boolean' ? String(value) : '';
}

function format(params: Template.Params): Format | undefined {
	let value = text(params.format).trim().toLowerCase();
	return value === 'rss' || value === 'atom' ? value : undefined;
}

function check(tag: string, props: helpers.Attrs, allowed: string[]): void {
	for (let key in props) {
		if (!allowed.includes(key)) throw new Error(`<feed:${tag}> unknown attribute "${key}"; supported: ${allowed.join(', ')}`);
	}
}

function link(html: string, ctx: Build.Context): string {
	return html.replace(LINK, (_, raw: string) => {
		let props = helpers.attrs(raw);
		check('link', props, LINK_ATTRS);

		let path = helpers.text(props.path);
		if (!path) throw new Error('<feed:link> missing required "path" attribute');

		let target = ctx.outputs.find(file => file.path === path);
		if (!target) throw new Error(`<feed:link path="${path}"> target not found; a feed is an output file, such as content${path}.hbs`);

		let kind = format(target.params);
		if (!kind) throw new Error(`<feed:link path="${path}"> target is missing required "format: rss|atom" frontmatter`);

		let title = helpers.text(props.title) || text(target.params.title) || 'Feed';
		return `<link rel="alternate" type="${helpers.MIME[kind]}" title="${helpers.xml(title)}" href="${helpers.xml(path)}" />`;
	});
}

function item(raw: string): Item {
	let props = helpers.attrs(raw);
	check('item', props, ITEM_ATTRS);
	for (let key of REQUIRED) {
		if (!helpers.text(props[key])) throw new Error(`<feed:item> missing required "${key}" attribute`);
	}
	return {
		href: helpers.text(props.href),
		title: helpers.text(props.title),
		date: helpers.text(props.date),
		summary: helpers.text(props.summary),
		content: helpers.text(props.content),
		id: helpers.text(props.id),
		author: helpers.text(props.author),
		tags: helpers.text(props.tags).split(',').map(tag => tag.trim()).filter(Boolean),
	};
}

function rss(meta: Channel, items: Item[]): string {
	let out = '<?xml version="1.0" encoding="utf-8"?>\n';
	out += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
	out += '<channel>\n';
	out += `<title>${helpers.xml(meta.title)}</title>\n`;
	if (meta.site) out += `<link>${helpers.xml(meta.site)}</link>\n`;
	out += `<description>${helpers.xml(meta.description || meta.subtitle || meta.title)}</description>\n`;
	if (meta.language) out += `<language>${helpers.xml(meta.language)}</language>\n`;
	if (meta.copyright) out += `<copyright>${helpers.xml(meta.copyright)}</copyright>\n`;
	out += `<atom:link href="${helpers.xml(meta.self)}" rel="self" type="${helpers.MIME.rss}"/>\n`;

	for (let it of items) {
		let url = helpers.url(it.href, meta.site);
		out += '<item>\n';
		out += `<title>${helpers.xml(it.title)}</title>\n`;
		out += `<link>${helpers.xml(url)}</link>\n`;
		out += `<guid isPermaLink="${it.id ? 'false' : 'true'}">${helpers.xml(it.id || url)}</guid>\n`;
		let pub = helpers.utc(it.date);
		if (pub) out += `<pubDate>${pub}</pubDate>\n`;
		if (it.summary) out += `<description>${helpers.xml(it.summary)}</description>\n`;
		// `]]>` cannot appear inside CDATA, so it is split across two sections
		if (it.content) out += `<content:encoded><![CDATA[${it.content.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>\n`;
		if (it.author) out += `<author>${helpers.xml(it.author)}</author>\n`;
		for (let tag of it.tags) out += `<category>${helpers.xml(tag)}</category>\n`;
		out += '</item>\n';
	}

	return out + '</channel>\n</rss>\n';
}

function atom(meta: Channel, items: Item[]): string {
	let out = '<?xml version="1.0" encoding="utf-8"?>\n';
	out += `<feed xmlns="http://www.w3.org/2005/Atom"${meta.language ? ` xml:lang="${helpers.xml(meta.language)}"` : ''}>\n`;
	out += `<title>${helpers.xml(meta.title)}</title>\n`;
	out += `<id>${helpers.xml(meta.self)}</id>\n`;
	out += `<link rel="self" href="${helpers.xml(meta.self)}" type="${helpers.MIME.atom}"/>\n`;
	if (meta.site) out += `<link rel="alternate" href="${helpers.xml(meta.site)}"/>\n`;
	let subtitle = meta.subtitle || meta.description;
	if (subtitle) out += `<subtitle>${helpers.xml(subtitle)}</subtitle>\n`;
	if (meta.copyright) out += `<rights>${helpers.xml(meta.copyright)}</rights>\n`;
	// Atom requires <updated>; an empty feed takes the build time, never the 1970 epoch
	out += `<updated>${new Date(helpers.latest(items.map(it => it.date)) ?? Date.now()).toISOString()}</updated>\n`;

	for (let it of items) {
		let url = helpers.url(it.href, meta.site);
		out += '<entry>\n';
		out += `<title>${helpers.xml(it.title)}</title>\n`;
		out += `<id>${helpers.xml(it.id || url)}</id>\n`;
		out += `<link href="${helpers.xml(url)}"/>\n`;
		let updated = helpers.iso(it.date);
		if (updated) out += `<updated>${updated}</updated>\n`;
		if (it.author) out += `<author><name>${helpers.xml(it.author)}</name></author>\n`;
		if (it.summary) out += `<summary>${helpers.xml(it.summary)}</summary>\n`;
		if (it.content) out += `<content type="html">${helpers.xml(it.content)}</content>\n`;
		for (let tag of it.tags) out += `<category term="${helpers.xml(tag)}"/>\n`;
		out += '</entry>\n';
	}

	return out + '</feed>\n';
}

function channel(html: string, ctx: Build.Context, kind: Format): string {
	let match = CHANNEL.exec(html);
	if (!match) throw new Error('A feed must contain a <feed:channel>...</feed:channel> block');

	let items = [...match[2].matchAll(ITEM)].map(found => item(found[1]));
	let { params, config } = ctx;
	let title = text(params.title);
	if (!title) throw new Error(`<feed:channel> "${ctx.path}" missing required "title" in frontmatter`);

	let site = config.$site.url;
	let meta: Channel = {
		title,
		description: text(params.description),
		subtitle: text(params.subtitle),
		language: text(params.language) || config.$site.lang,
		copyright: text(params.copyright),
		self: helpers.url(ctx.path, site),
		site,
	};

	return kind === 'atom' ? atom(meta, items) : rss(meta, items);
}

/**
 * Write RSS or Atom feeds from `<feed:channel>` and `<feed:item>` elements in output files whose
 * frontmatter has `format: rss` or `format: atom`, and turn each `<feed:link path="…" />` in a page
 * into a `<link rel="alternate">` to that feed.
 * @example
 * import { feed } from '@bongo/feed';
 * export default { plugins: [feed()] };
 */
export function feed(): Partial<Config> {
	return {
		$hooks: {
			transform(html, ctx) {
				if (ctx.kind === 'page') return html.includes('<feed:link') ? link(html, ctx) : html;
				let kind = format(ctx.params);
				return kind ? channel(html, ctx, kind) : html;
			},
		},
	};
}
