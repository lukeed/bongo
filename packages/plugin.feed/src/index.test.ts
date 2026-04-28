import { describe, expect, test } from 'bun:test';

import { feed } from './index';

import type { Build, Config, Template } from 'bongo';

function page(path: string, params: Template.Params = {}): Template.PageInfo {
	return {
		path,
		params,
		title: typeof params.title === 'string' ? params.title : path,
		summary: typeof params.summary === 'string' ? params.summary : '',
		section: path.startsWith('/blog/') ? 'blog' : '',
		tags: typeof params.tags === 'string' ? params.tags.split(',') : [],
		url: new URL(path, 'https://example.com/').href,
	};
}

function siteConfig(): Config {
	return {
		$site: { title: 'Example', url: 'https://example.com/', lang: 'en' },
	};
}

// Build a fake Build.Context — only the fields the plugin reads are populated.
function ctx(pages: Template.PageInfo[]): Build.Context {
	return {
		config: siteConfig(),
		pages,
		sections: new Map(),
		tags: [],
	};
}

// The plugin's `feed` block is exported via `$blocks`. Pull it out so we
// can drive it directly the way tempura would.
function getBlock(plugin: Partial<Config>): (args: Record<string, unknown>) => string {
	let block = plugin.$blocks && plugin.$blocks.feed;
	if (!block) throw new Error('plugin missing $blocks.feed');
	// The plugin's block is synchronous, but `$blocks` is typed as
	// Promisable<string>; resolve it eagerly here for ergonomic asserts.
	return (args) => {
		let result = block(args);
		if (typeof result !== 'string') throw new Error('feed block returned non-string');
		return result;
	};
}

describe('feed() pages hook', () => {
	test('attaches <link rel="alternate"> data to every page matching attach=', async () => {
		let plugin = feed();
		let pages = [
			page('/', { title: 'Home' }),
			page('/blog/post-1/', { title: 'Post 1', date: '2025-01-01' }),
			page('/blog/post-2/', { title: 'Post 2', date: '2025-02-01' }),
			page('/blog/feed.xml', {
				output: '/blog/feed.xml',
				attach: '/blog/',
				format: 'rss',
				title: 'Blog Feed',
			}),
		];

		await plugin.$hooks!.pages!(ctx(pages));

		// `/` is outside `/blog/` — no feed attached.
		expect(pages[0].feeds).toBeUndefined();
		// Both blog posts pick up the feed.
		expect(pages[1].feeds).toEqual([{
			format: 'rss',
			path: '/blog/feed.xml',
			title: 'Blog Feed',
			type: 'application/rss+xml',
			url: 'https://example.com/blog/post-1/'.replace('/blog/post-1/', '/blog/feed.xml'),
		}]);
		expect(pages[2].feeds).toEqual([{
			format: 'rss',
			path: '/blog/feed.xml',
			title: 'Blog Feed',
			type: 'application/rss+xml',
			url: 'https://example.com/blog/feed.xml',
		}]);
		// The feed page does NOT advertise itself.
		expect(pages[3].feeds).toBeUndefined();
	});

	test('does not modify page registry when no feed pages are present', async () => {
		let plugin = feed();
		let pages = [
			page('/', { title: 'Home' }),
			page('/blog/post/', { title: 'Post' }),
		];

		await plugin.$hooks!.pages!(ctx(pages));

		expect(pages[0].feeds).toBeUndefined();
		expect(pages[1].feeds).toBeUndefined();
	});

	test('attach= as a predicate function is honoured', async () => {
		let plugin = feed();
		let pages = [
			page('/', { title: 'Home', tags: 'recipe' }),
			page('/blog/post/', { title: 'Post' }),
			page('/feed.xml', {
				output: '/feed.xml',
				attach: (p: Template.PageInfo) => p.tags.includes('recipe'),
				title: 'Recipes',
			}),
		];

		await plugin.$hooks!.pages!(ctx(pages));

		expect(pages[0].feeds).toBeDefined();
		expect(pages[1].feeds).toBeUndefined();
	});
});

describe('feed() block (RSS)', () => {
	test('renders an RSS body with channel + items', async () => {
		let plugin = feed();
		let posts = [
			page('/blog/post-1/', { title: 'Post 1', summary: 'Body 1', date: '2025-01-01' }),
			page('/blog/post-2/', { title: 'Post 2', summary: 'Body 2', date: '2025-02-01' }),
		];

		// Run pages hook first to populate the site closure.
		await plugin.$hooks!.pages!(ctx(posts));

		let block = getBlock(plugin);
		let xml = block({
			format: 'rss',
			title: 'Blog',
			url: 'https://example.com/blog/feed.xml',
			items: posts,
		});

		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain('<title>Blog</title>');
		expect(xml).toContain('<atom:link href="https://example.com/blog/feed.xml" rel="self" type="application/rss+xml"/>');
		expect(xml).toContain('<title>Post 1</title>');
		expect(xml).toContain('<title>Post 2</title>');
		expect(xml).toContain('<pubDate>');
	});
});

describe('feed() block (Atom)', () => {
	test('renders an Atom body with entries', async () => {
		let plugin = feed();
		let posts = [
			page('/blog/post-1/', { title: 'Post 1', summary: 'Body 1', date: '2025-01-01' }),
			page('/blog/post-2/', { title: 'Post 2', summary: 'Body 2', date: '2025-03-01' }),
		];

		await plugin.$hooks!.pages!(ctx(posts));

		let block = getBlock(plugin);
		let xml = block({
			format: 'atom',
			title: 'Blog',
			url: 'https://example.com/blog/feed.xml',
			items: posts,
		});

		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(xml).toContain('<entry>');
		expect(xml).toContain('<title>Post 1</title>');
		expect(xml).toContain('<title>Post 2</title>');
		// Latest item's date wins for <updated>.
		expect(xml).toMatch(/<updated>2025-03-01T/);
	});

	test('omits <updated> on empty-items feeds rather than emitting the 1970 epoch', async () => {
		let plugin = feed();
		let block = getBlock(plugin);
		let xml = block({
			format: 'atom',
			title: 'Empty',
			url: 'https://example.com/empty.xml',
			items: [],
		});

		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		// Critical: no 1970 epoch leaks into <updated>.
		expect(xml).not.toContain('1970-01-01');
		expect(xml).not.toContain('<updated>');
		expect(xml).not.toContain('<entry>');
	});
});

describe('feed() block (custom render)', () => {
	test('honours a per-call `render=` mapper for item shape', async () => {
		let plugin = feed();
		let posts = [
			page('/blog/post-1/', { title: 'Post 1', summary: 'Body 1', date: '2025-01-01', author: 'lukeed' }),
		];

		await plugin.$hooks!.pages!(ctx(posts));

		let block = getBlock(plugin);
		let xml = block({
			format: 'rss',
			title: 'Blog',
			url: 'https://example.com/feed.xml',
			items: posts,
			render: (p: Template.PageInfo) => ({
				title: p.title.toUpperCase(),
				url: p.url,
				summary: 'mapped:' + p.summary,
				date: p.params.date,
				author: typeof p.params.author === 'string' ? p.params.author : undefined,
			}),
		});

		expect(xml).toContain('<title>POST 1</title>');
		expect(xml).toContain('<description>mapped:Body 1</description>');
		expect(xml).toContain('<author>lukeed</author>');
	});
});

describe('feed() block (jsonl)', () => {
	test('renders one JSON object per line', async () => {
		let plugin = feed();
		let posts = [
			page('/blog/post-1/', { title: 'Post 1', summary: 'Body 1', date: '2025-01-01' }),
		];

		let block = getBlock(plugin);
		let body = block({
			format: 'jsonl',
			title: 'Blog',
			items: posts,
		});

		let lines = body.split('\n').filter(Boolean);
		expect(lines.length).toBe(1);
		let parsed = JSON.parse(lines[0]);
		expect(parsed.title).toBe('Post 1');
		expect(parsed.url).toBe('https://example.com/blog/post-1/');
	});
});
