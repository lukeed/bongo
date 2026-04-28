import { describe, expect, test } from 'bun:test';
import { feed } from './index';

import type { Build, Config, Template } from 'bongo';

// Helpers — build the minimal fixtures needed to exercise the plugin's
// hooks in isolation, without spinning up a real bongo build.

function makeConfig(): Config {
	return {
		$site: {
			url: 'https://example.com/',
			lang: 'en',
			title: 'Test Site',
			description: 'A test site',
		},
	};
}

function makePage(over: Partial<Template.PageInfo>): Template.PageInfo {
	return {
		path: '/',
		url: 'https://example.com/',
		title: '',
		summary: '',
		section: '',
		tags: [],
		params: {},
		...over,
	};
}

function makeFeedSource(over: Partial<Build.FeedSource> & { format: Build.FeedSource['format'] }): Build.FeedSource {
	return {
		rel: 'feed.xml.hbs',
		path: '/feed.xml',
		title: 'Feed',
		attach: '',
		params: {},
		body: '',
		...over,
	};
}

function makeContext(feeds: Build.FeedSource[], pages: Template.PageInfo[]): Build.OutputContext {
	let writes: Array<[string, string | Uint8Array]> = [];
	let context: Build.OutputContext = {
		config: makeConfig(),
		pages,
		sections: new Map(),
		tags: [],
		feeds,
		write(p, c) {
			writes.push([p, c]);
		},
	};
	// Stash writes on the context for the test to inspect.
	(context as Build.OutputContext & { _writes: typeof writes })._writes = writes;
	return context;
}

describe('@bongo/feed: pages hook (link injection)', () => {
	test('attaches feed Link to every page when attach is empty', async () => {
		let plugin = feed();
		let pages = [
			makePage({ path: '/' }),
			makePage({ path: '/blog/' }),
			makePage({ path: '/about/' }),
		];
		let feeds = [makeFeedSource({
			format: 'rss',
			path: '/feed.xml',
			title: 'Site',
			attach: '',
		})];
		let context = makeContext(feeds, pages);
		await plugin.$hooks!.pages!(context);

		for (let page of pages) {
			expect(page.feeds).toBeDefined();
			expect(page.feeds!.length).toBe(1);
			expect(page.feeds![0].format).toBe('rss');
			expect(page.feeds![0].url).toBe('https://example.com/feed.xml');
			expect(page.feeds![0].type).toBe('application/rss+xml');
		}
	});

	test('only attaches to pages whose path matches attach prefix', async () => {
		let plugin = feed();
		let pages = [
			makePage({ path: '/' }),
			makePage({ path: '/blog/' }),
			makePage({ path: '/blog/post-a/' }),
			makePage({ path: '/about/' }),
		];
		let feeds = [makeFeedSource({
			format: 'atom',
			path: '/blog/feed.xml',
			title: 'Blog',
			attach: '/blog/',
		})];
		let context = makeContext(feeds, pages);
		await plugin.$hooks!.pages!(context);

		// /blog/ and /blog/post-a/ get a link, root and /about/ do not.
		expect(pages[0].feeds).toBeUndefined();
		expect(pages[1].feeds!.length).toBe(1);
		expect(pages[1].feeds![0].format).toBe('atom');
		expect(pages[2].feeds!.length).toBe(1);
		expect(pages[3].feeds).toBeUndefined();
	});

	test('attach without trailing slash is normalised', async () => {
		let plugin = feed();
		let pages = [
			makePage({ path: '/blog/' }),
			makePage({ path: '/blogger/' }),
		];
		let feeds = [makeFeedSource({
			format: 'rss',
			path: '/blog/feed.xml',
			title: 'Blog',
			// `blog` (no slashes) -> normalised to '/blog/'.
			attach: 'blog',
		})];
		let context = makeContext(feeds, pages);
		await plugin.$hooks!.pages!(context);

		// /blog/ matches, /blogger/ must NOT (would have if we forgot the trailing slash).
		expect(pages[0].feeds!.length).toBe(1);
		expect(pages[1].feeds).toBeUndefined();
	});

	test('multiple feeds stack on the same page', async () => {
		let plugin = feed();
		let pages = [makePage({ path: '/blog/' })];
		let feeds = [
			makeFeedSource({ format: 'rss', path: '/blog/feed.xml', title: 'RSS', attach: '/blog/' }),
			makeFeedSource({ format: 'atom', path: '/blog/feed.atom', title: 'Atom', attach: '/blog/' }),
		];
		let context = makeContext(feeds, pages);
		await plugin.$hooks!.pages!(context);

		expect(pages[0].feeds!.length).toBe(2);
		expect(pages[0].feeds!.map(f => f.format).sort()).toEqual(['atom', 'rss']);
	});
});

describe('@bongo/feed: output hook (RSS render)', () => {
	test('emits valid <rss> envelope with item entries', async () => {
		let plugin = feed();
		let body = [
			JSON.stringify({ title: 'A', url: 'https://example.com/a/', date: '2024-01-01', summary: 'A summary' }),
			JSON.stringify({ title: 'B', url: 'https://example.com/b/', date: '2024-02-01', author: 'lukeed' }),
		].join('\n');

		let feeds = [makeFeedSource({
			format: 'rss',
			path: '/feed.xml',
			title: 'Test Feed',
			body,
		})];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		expect(writes.length).toBe(1);
		let [path, xml] = writes[0];
		expect(path).toBe('/feed.xml');
		expect(typeof xml).toBe('string');

		expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain('<title>Test Feed</title>');
		expect(xml).toContain('<title>A</title>');
		expect(xml).toContain('<title>B</title>');
		expect(xml).toContain('<link>https://example.com/a/</link>');
		expect(xml).toContain('<author>lukeed</author>');
		// Newest first (default sort by date desc).
		expect(xml.indexOf('<title>B</title>')).toBeLessThan(xml.indexOf('<title>A</title>'));
	});

	test('escapes XML-unsafe characters in title/url/summary', async () => {
		let plugin = feed();
		let body = JSON.stringify({
			title: 'A & B <c>',
			url: 'https://example.com/?x=1&y=2',
			summary: `quote "text" 'apos'`,
			date: '2024-01-01',
		});
		let feeds = [makeFeedSource({ format: 'rss', body })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;
		expect(xml).toContain('A &amp; B &lt;c&gt;');
		expect(xml).toContain('?x=1&amp;y=2');
		expect(xml).toContain('quote &quot;text&quot; &apos;apos&apos;');
		// Raw unescaped should NEVER appear.
		expect(xml).not.toContain('A & B <c>');
	});
});

describe('@bongo/feed: output hook (Atom render)', () => {
	test('emits valid <feed> envelope with entries', async () => {
		let plugin = feed();
		let body = [
			JSON.stringify({ title: 'A', url: 'https://example.com/a/', date: '2024-01-01' }),
			JSON.stringify({ title: 'B', url: 'https://example.com/b/', date: '2024-02-01', author: 'lukeed' }),
		].join('\n');

		let feeds = [makeFeedSource({
			format: 'atom',
			path: '/feed.atom',
			title: 'Atom Feed',
			body,
		})];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;

		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(xml).toContain('<title>Atom Feed</title>');
		expect(xml).toContain('<entry>');
		expect(xml).toContain('<id>https://example.com/a/</id>');
		expect(xml).toContain('<author><name>lukeed</name></author>');
		// `<updated>` reflects the latest entry date — must be ISO-8601, not epoch.
		let updatedMatch = xml.match(/<updated>([^<]+)<\/updated>/);
		expect(updatedMatch).not.toBeNull();
		expect(updatedMatch![1]).toBe('2024-02-01T00:00:00.000Z');
	});

	test('empty feed does NOT emit 1970 epoch in <updated>', async () => {
		let plugin = feed();
		let feeds = [makeFeedSource({ format: 'atom', body: '' })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;

		// Empty feed still emits one <updated> at the feed level — but it must
		// be NOW-ish, never the epoch (which would be a feed-validator red flag).
		expect(xml).not.toContain('1970-01-01');
		let updatedMatch = xml.match(/<updated>([^<]+)<\/updated>/);
		expect(updatedMatch).not.toBeNull();
		let when = new Date(updatedMatch![1]).getTime();
		// Within 60s of NOW.
		expect(Math.abs(Date.now() - when)).toBeLessThan(60_000);
	});

	test('skips empty lines and // comments in body', async () => {
		let plugin = feed();
		let body = [
			'// Header comment',
			'',
			JSON.stringify({ title: 'Real', url: 'https://example.com/r/', date: '2024-01-01' }),
			'',
			'// Trailing',
		].join('\n');

		let feeds = [makeFeedSource({ format: 'atom', body })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;
		expect(xml).toContain('<title>Real</title>');
		// Only one <entry>.
		let entryCount = (xml.match(/<entry>/g) || []).length;
		expect(entryCount).toBe(1);
	});

	test('throws a useful error on malformed JSON line', async () => {
		let plugin = feed();
		// `{x:1}` is not valid JSON (unquoted keys).
		let body = '{x:1}';
		let feeds = [makeFeedSource({ rel: 'blog/feed.xml.hbs', format: 'rss', body })];
		let context = makeContext(feeds, []);

		let err: Error | null = null;
		try {
			await plugin.$hooks!.output!(context);
		} catch (e) {
			err = e as Error;
		}
		expect(err).not.toBeNull();
		expect(err!.message).toContain('blog/feed.xml.hbs');
		expect(err!.message.toLowerCase()).toContain('not valid json');
	});

	test('throws on unterminated JSON object', async () => {
		let plugin = feed();
		let feeds = [makeFeedSource({ rel: 'feed.xml.hbs', format: 'rss', body: '{ "title": "x"' })];
		let context = makeContext(feeds, []);
		let err: Error | null = null;
		try {
			await plugin.$hooks!.output!(context);
		} catch (e) { err = e as Error; }
		expect(err).not.toBeNull();
		expect(err!.message).toContain('feed.xml.hbs');
		expect(err!.message.toLowerCase()).toContain('unterminated');
	});

	test('accepts a JSON array literal as body', async () => {
		let plugin = feed();
		let body = JSON.stringify([
			{ title: 'A', url: 'https://example.com/a/', date: '2024-01-01' },
			{ title: 'B', url: 'https://example.com/b/', date: '2024-02-01' },
		]);
		let feeds = [makeFeedSource({ format: 'atom', body })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;
		expect(xml).toContain('<title>A</title>');
		expect(xml).toContain('<title>B</title>');
		// Two entries.
		let entries = (xml.match(/<entry>/g) || []).length;
		expect(entries).toBe(2);
	});
});

describe('@bongo/feed: limit option', () => {
	test('caps emitted items at the configured limit', async () => {
		let plugin = feed({ limit: 2 });
		let lines: string[] = [];
		for (let i = 0; i < 5; i++) {
			lines.push(JSON.stringify({
				title: `Item ${i}`,
				url: `https://example.com/${i}/`,
				// Increasing dates so the most-recent (Item 4, Item 3) win.
				date: `2024-01-0${i + 1}`,
			}));
		}
		let feeds = [makeFeedSource({ format: 'rss', body: lines.join('\n') })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		let xml = writes[0][1] as string;

		let itemCount = (xml.match(/<item>/g) || []).length;
		expect(itemCount).toBe(2);
		// The two most recent: Item 4 and Item 3.
		expect(xml).toContain('Item 4');
		expect(xml).toContain('Item 3');
		expect(xml).not.toContain('Item 0');
	});
});

describe('@bongo/feed: jsonl format', () => {
	test('passes through items as ndjson, sorted by date desc', async () => {
		let plugin = feed();
		let body = [
			JSON.stringify({ title: 'Old', url: 'https://example.com/old/', date: '2024-01-01' }),
			JSON.stringify({ title: 'New', url: 'https://example.com/new/', date: '2024-12-01' }),
		].join('\n');
		let feeds = [makeFeedSource({ format: 'jsonl', path: '/feed.jsonl', body })];
		let context = makeContext(feeds, []);
		await plugin.$hooks!.output!(context);

		let writes = (context as { _writes: Array<[string, string]> })._writes;
		expect(writes[0][0]).toBe('/feed.jsonl');
		let out = writes[0][1] as string;
		let parts = out.trim().split('\n');
		expect(parts.length).toBe(2);
		// Newest first.
		expect(JSON.parse(parts[0]).title).toBe('New');
		expect(JSON.parse(parts[1]).title).toBe('Old');
	});
});
