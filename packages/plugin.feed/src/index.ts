import type { Build, Config, Feed, Template } from 'bongo';

// A feed item, as the user emits one-per-line from a `.hbs` feed body. The
// loose shape lets users tack extra keys on (e.g. `image`, `categories`)
// without us caring; the renderers only read the canonical fields below.
export type FeedItem = {
	title: string;
	url: string;
	id?: string;
	summary?: string;
	content?: string;
	date?: string | number;
	author?: string;
	[name: string]: unknown;
};

export type Options = {
	limit?: number;
};

const MIME: Record<Feed.Format, string> = {
	atom: 'application/atom+xml',
	jsonl: 'application/x-ndjson',
	rss: 'application/rss+xml',
};

const DEFAULT_LIMIT = 50;

// XML-safe escape — the same five entity rule the reference branch uses, kept
// internal so users can't accidentally double-escape via tempura's default
// HTML escape (tempura escapes `<>&` but not `'"`, which are required here).
function xml(value: unknown): string {
	let input = value == null ? '' : String(value);
	let output = '';
	for (let i = 0; i < input.length; i++) {
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
	if (!value) return '';
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

// Pick the most recent item date, or fall back to NOW for empty feeds. The
// fall-back avoids emitting `1970-01-01T00:00:00.000Z` (epoch) into Atom's
// mandatory `<updated>` field — feed validators flag epoch dates loudly.
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
	return winner === undefined ? Date.now() : winner;
}

// Parse the rendered body. We accept three shapes so feed templates aren't
// boxed in by tempura's whitespace handling:
//   1. A JSON array literal — `[ {...}, {...} ]`
//   2. JSON-lines — one object per non-blank line
//   3. Concatenated JSON objects — `{...}{...}{...}` (tempura collapses
//      newlines at block boundaries, so this is the natural emission shape
//      for `{{#each ...}}{...}{{/each}}` bodies).
// Blank lines and `// comment` lines are tolerated. Invalid JSON throws —
// better to fail loud than silently emit a corrupt feed.
function parseItems(body: string, rel: string): FeedItem[] {
	let trimmed = body.trim();
	if (!trimmed) return [];

	// Shape 1 — JSON array literal.
	if (trimmed.charAt(0) === '[') {
		try {
			var parsed = JSON.parse(trimmed) as unknown;
		} catch (err) {
			let reason = err instanceof Error ? err.message : String(err);
			throw new Error(`@bongo/feed: ${rel} is not a valid JSON array: ${reason}`);
		}
		if (!Array.isArray(parsed)) {
			throw new Error(`@bongo/feed: ${rel} parsed to a non-array value`);
		}
		return parsed.filter((v): v is FeedItem => !!v && typeof v === 'object');
	}

	// Shape 3 — concatenated JSON objects. Walk the string with a brace
	// counter (respecting strings/escapes) and slice out each object.
	let items: FeedItem[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escape = false;

	for (let i = 0; i < trimmed.length; i++) {
		let ch = trimmed[i];

		if (inString) {
			if (escape) { escape = false; continue; }
			if (ch === '\\') { escape = true; continue; }
			if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') { inString = true; continue; }

		if (ch === '/' && trimmed[i + 1] === '/' && depth === 0) {
			// Skip a `//` comment to end of line.
			let nl = trimmed.indexOf('\n', i);
			if (nl < 0) break;
			i = nl;
			continue;
		}

		if (ch === '{') {
			if (depth === 0) start = i;
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0 && start >= 0) {
				let chunk = trimmed.substring(start, i + 1);
				try {
					var item = JSON.parse(chunk) as unknown;
				} catch (err) {
					let reason = err instanceof Error ? err.message : String(err);
					throw new Error(`@bongo/feed: ${rel} line ${lineOf(trimmed, start)} is not valid JSON: ${reason}`);
				}
				if (!item || typeof item !== 'object') {
					throw new Error(`@bongo/feed: ${rel} line ${lineOf(trimmed, start)} did not produce a JSON object`);
				}
				items.push(item as FeedItem);
				start = -1;
			} else if (depth < 0) {
				throw new Error(`@bongo/feed: ${rel} has unbalanced '}' at line ${lineOf(trimmed, i)}`);
			}
		}
	}

	if (depth !== 0) {
		throw new Error(`@bongo/feed: ${rel} has an unterminated JSON object (depth=${depth})`);
	}

	if (items.length === 0 && trimmed.length > 0) {
		// Body was non-empty but had no `{` — almost certainly a template bug.
		throw new Error(`@bongo/feed: ${rel} produced no JSON objects (body did not start with '{' or '[')`);
	}

	return items;
}

function lineOf(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === '\n') line++;
	}
	return line;
}

function rss(
	source: Build.FeedSource,
	site: Template.Site,
	items: FeedItem[],
	feedUrl: string,
	type: string,
): string {
	let description = site.description || source.title;
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
	output += '<channel>\n';
	output += `<title>${xml(source.title)}</title>\n`;
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

function atom(
	source: Build.FeedSource,
	site: Template.Site,
	items: FeedItem[],
	feedUrl: string,
	type: string,
): string {
	let output = '<?xml version="1.0" encoding="utf-8"?>\n';
	output += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
	output += `<title>${xml(source.title)}</title>\n`;
	output += `<id>${xml(feedUrl)}</id>\n`;
	output += `<link href="${xml(feedUrl)}" rel="self" type="${type}"/>\n`;
	output += `<link href="${xml(site.url)}"/>\n`;
	output += `<updated>${xml(iso(latest(items)))}</updated>\n`;

	for (let item of items) {
		let id = item.id || item.url;
		let summary = item.summary || item.content;
		output += '<entry>\n';
		output += `<title>${xml(item.title)}</title>\n`;
		output += `<id>${xml(id)}</id>\n`;
		output += `<link href="${xml(item.url)}"/>\n`;
		// Atom requires `<updated>` per entry. Empty `date` falls back to the
		// feed-level latest stamp (which itself falls back to NOW for empty
		// feeds — see latest()).
		let when = item.date ? item.date : latest(items);
		output += `<updated>${xml(iso(when))}</updated>\n`;
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

function render(
	source: Build.FeedSource,
	site: Template.Site,
	items: FeedItem[],
): string {
	let type = MIME[source.format];
	let feedUrl = new URL(source.path, site.url || 'https://example.com/').href;
	if (source.format === 'atom') return atom(source, site, items, feedUrl, type);
	if (source.format === 'jsonl') return jsonl(items);
	return rss(source, site, items, feedUrl, type);
}

// Default sort: most recent first. Stable enough for typical blog usage.
// Items without a parseable `date` sort to the end (time() returns 0).
function sortByDate(items: FeedItem[]): FeedItem[] {
	return items.slice().sort((a, b) => time(b.date) - time(a.date));
}

export function feed(options: Options = {}): Partial<Config> {
	let limit = options.limit ?? DEFAULT_LIMIT;

	return {
		$hooks: {
			pages(context) {
				// Attach <link rel="alternate"> hints. Each feed source's `attach`
				// frontmatter is treated as a URL prefix; pages whose path starts
				// with that prefix get a Feed.Link record on `page.feeds`. An
				// empty `attach` is treated as "site-wide" (every page).
				let { config, pages, feeds } = context;
				if (feeds.length === 0) return;

				for (let source of feeds) {
					let scope = prefix(source.attach);
					let type = MIME[source.format];
					let feedUrl = new URL(
						source.path,
						config.$site.url || 'https://example.com/',
					).href;

					let link: Feed.Link = {
						format: source.format,
						path: source.path,
						title: source.title,
						type,
						url: feedUrl,
					};

					for (let page of pages) {
						if (scope && !page.path.startsWith(scope)) continue;
						let list = page.feeds || [];
						list.push(link);
						page.feeds = list;
					}
				}
			},

			async output(context) {
				let { config, feeds, write } = context;
				if (feeds.length === 0) return;

				for (let source of feeds) {
					let items = parseItems(source.body, source.rel);
					let sorted = sortByDate(items);
					if (sorted.length > limit) sorted = sorted.slice(0, limit);
					let xml_out = render(source, config.$site, sorted);
					await write(source.path, xml_out);
				}
			},
		},
	};
}
