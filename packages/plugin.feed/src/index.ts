import type { Build, Config, Feed as CoreFeed, Template } from 'bongo';

// ---------------------------------------------------------------------------
// @bongo/feed — feed-as-tempura-tag (Option 1)
//
// Exposes a `<bongo:feed format="..." title="..." items=posts />` tag that
// content authors can drop into a single-tag `.xml.hbs` file. The core
// engine rewrites that to `{{#feed format="..." title="..." items=posts}}`
// before tempura compiles, so the `items` attribute resolves against the
// surrounding tempura scope (not against an HTML string).
//
// Two cooperating pieces ship in this plugin:
//
//   1. A `feed` tempura block (registered via Config.$blocks). At template
//      eval time it receives `(args, blocks)` and returns the rendered
//      RSS / Atom / JSONL body. The block reaches the `Template.Site` for
//      self-link/url construction via a closure populated by (2).
//
//   2. A `pages` hook that walks every collected page, identifies feed
//      pages by their `output:` + `attach:` frontmatter, and decorates
//      every matching page with a `feeds: Feed.Link[]` entry so layouts
//      can render `<link rel="alternate">` elements.
//
// Why a closure-captured site reference (and not args)?
// Tempura blocks are invoked with `(args, blocks)` — there is no scope
// object passed in. Reading `$site.url` from each `<bongo:feed/>`
// invocation would require every call site to spell `site=$site`, which
// is hostile to the “drop a single tag and get a feed” authoring story.
// The `pages` hook runs before walk-2, so the closure is populated long
// before any block invocation.
// ---------------------------------------------------------------------------

const MIME: Record<CoreFeed.Format, string> = {
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

function isPageInfo(value: unknown): value is Template.PageInfo {
	if (!value || typeof value !== 'object') return false;
	let v = value as { path?: unknown; params?: unknown };
	return typeof v.path === 'string' && typeof v.params === 'object';
}

function defaultRender(page: Template.PageInfo): CoreFeed.Item {
	return {
		title: page.title,
		url: page.url,
		summary: page.summary,
		date: page.params.date,
	};
}

// Map `items=` attribute to `Feed.Item[]`. PageInfo entries flow through
// `render` (or defaultRender); pre-shaped Item entries pass through.
function toItems(
	items: Template.PageInfo[] | CoreFeed.Item[] | undefined,
	render?: (page: Template.PageInfo) => CoreFeed.Item,
): CoreFeed.Item[] {
	if (!items) return [];
	let out: CoreFeed.Item[] = [];
	let mapper = render || defaultRender;
	for (let item of items) {
		out.push(isPageInfo(item) ? mapper(item) : (item as CoreFeed.Item));
	}
	return out;
}

function rss(
	site: Template.Site,
	feedUrl: string,
	title: string,
	description: string,
	type: string,
	items: CoreFeed.Item[],
): string {
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
	output += '<channel>\n';
	output += `<title>${xml(title)}</title>\n`;
	output += `<link>${xml(site.url)}</link>\n`;
	output += `<description>${xml(description)}</description>\n`;
	output += `<atom:link href="${xml(feedUrl)}" rel="self" type="${type}"/>\n`;

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

// Latest item date — feeds the `<updated>` field. Returns `undefined` when
// no item carries a date so the caller can omit `<updated>` rather than
// emitting the 1970 epoch (which is what `new Date(0).toISOString()` returns).
function latest(items: CoreFeed.Item[]): unknown {
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

function atom(
	site: Template.Site,
	feedUrl: string,
	title: string,
	type: string,
	items: CoreFeed.Item[],
): string {
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
	output += `<title>${xml(title)}</title>\n`;
	output += `<id>${xml(feedUrl)}</id>\n`;
	output += `<link href="${xml(feedUrl)}" rel="self" type="${type}"/>\n`;
	output += `<link href="${xml(site.url)}"/>\n`;
	// Skip `<updated>` entirely on empty/dateless feeds rather than
	// emitting `1970-01-01T00:00:00.000Z`.
	let updated = latest(items);
	if (updated !== undefined) {
		output += `<updated>${xml(iso(updated))}</updated>\n`;
	}

	for (let item of items) {
		let id = item.id || item.url;
		let summary = item.summary || item.content;
		output += '<entry>\n';
		output += `<title>${xml(item.title)}</title>\n`;
		output += `<id>${xml(id)}</id>\n`;
		output += `<link href="${xml(item.url)}"/>\n`;
		if (item.date) output += `<updated>${xml(iso(item.date))}</updated>\n`;
		if (summary) output += `<summary>${xml(summary)}</summary>\n`;
		if (item.author) output += `<author><name>${xml(item.author)}</name></author>\n`;
		output += '</entry>\n';
	}

	output += '</feed>\n';
	return output;
}

function jsonl(items: CoreFeed.Item[]): string {
	let output = '';
	for (let item of items) {
		output += JSON.stringify(item) + '\n';
	}
	return output;
}

// Read a Registration from a feed page's front-matter. Returns null when
// the page is not a feed (no `output:` + `attach:` pair).
function asRegistration(page: Template.PageInfo): CoreFeed.Link & { attach: string | ((page: Template.PageInfo) => boolean) } | null {
	let params = page.params;
	let output = params.output;
	let attach = params.attach;
	if (typeof output !== 'string') return null;
	if (typeof attach !== 'string' && typeof attach !== 'function') return null;

	let formatRaw = params.format;
	let format: CoreFeed.Format = formatRaw === 'atom'
		? 'atom'
		: formatRaw === 'jsonl'
			? 'jsonl'
			: 'rss';

	let title = typeof params.title === 'string' ? params.title : page.title;

	return {
		format,
		path: path(output),
		title,
		type: MIME[format],
		url: page.url,
		attach,
	};
}

function attaches(reg: { attach: string | ((page: Template.PageInfo) => boolean) }, page: Template.PageInfo): boolean {
	if (typeof reg.attach === 'function') return reg.attach(page);
	let scope = prefix(reg.attach);
	return page.path.startsWith(scope);
}

// Closure used by both the `pages` hook (writes) and the `feed` block
// (reads). Set once per build run.
type SiteRef = { site: Template.Site | null };

export function feed(): Partial<Config> {
	let ref: SiteRef = { site: null };

	function feedBlock(args: Record<string, unknown>): string {
		let typed = args as CoreFeed.Args;
		let format = typed.format || 'rss';
		let title = typed.title || '';
		let description = typed.description || title;
		let type = MIME[format];
		// `url` lets callers self-link the feed (defaults to '' so the
		// caller is forced to pass `url=$page.url` for full self-referential
		// links — the pre-pass rewrites <bongo:feed/> verbatim, so any
		// scope ident works here).
		let feedUrl = typed.url || '';
		let items = toItems(typed.items, typed.render);

		// Site is captured by the `pages` hook below. If `<bongo:feed/>` is
		// invoked outside of a build (e.g. a partial preview) we degrade
		// gracefully with an empty site URL — tests rely on this.
		let site: Template.Site = ref.site || { url: '', lang: '', title: '' };

		if (format === 'atom') return atom(site, feedUrl, title, type, items);
		if (format === 'jsonl') return jsonl(items);
		return rss(site, feedUrl, title, description, type, items);
	}

	function pagesHook(context: Build.Context): void {
		ref.site = context.config.$site;

		// Find every feed page (frontmatter has `output:` + `attach:`).
		let registrations: ReturnType<typeof asRegistration>[] = [];
		for (let page of context.pages) {
			let reg = asRegistration(page);
			if (reg) registrations.push(reg);
		}
		if (registrations.length === 0) return;

		// Decorate every matching page with a Feed.Link. We skip the feed
		// page itself so feeds don't recursively advertise themselves.
		for (let page of context.pages) {
			if (asRegistration(page)) continue;
			for (let reg of registrations) {
				if (!reg) continue;
				if (!attaches(reg, page)) continue;
				let list = page.feeds || [];
				list.push({
					format: reg.format,
					path: reg.path,
					title: reg.title,
					type: reg.type,
					url: reg.url,
				});
				page.feeds = list;
			}
		}
	}

	return {
		$blocks: {
			feed: feedBlock,
		},
		$hooks: {
			pages: pagesHook,
		},
	};
}
