import { describe, expect, test } from 'bun:test';

import { feed } from './index';

import type { Template } from 'bongo';

function page(path: string, params: Template.Params = {}): Template.PageInfo {
	return {
		path,
		params,
		title: String(params.title || path),
		summary: String(params.summary || ''),
		section: path.startsWith('/blog/') ? 'blog' : '',
		tags: typeof params.tags === 'string' ? params.tags.split(',') : [],
		url: new URL(path, 'https://example.com/').href,
	};
}

describe('feed()', () => {
	test('uses attach "/" to advertise a feed on every page', async () => {
		let plugin = feed([{
			path: '/feed.xml',
			title: 'Everything',
			attach: '/',
		}]);
		let pages = [
			page('/', { title: 'Home' }),
			page('/blog/post/', { title: 'Post' }),
		];

		await plugin.$hooks!.pages!({
			config: {
				$site: { title: 'Example', url: 'https://example.com/', lang: 'en' },
			},
			pages,
			sections: new Map(),
			tags: [],
		});

		expect(pages[0].feeds).toEqual([{
			format: 'rss',
			path: '/feed.xml',
			title: 'Everything',
			type: 'application/rss+xml',
			url: 'https://example.com/feed.xml',
		}]);
		expect(pages[1].feeds).toEqual(pages[0].feeds);
	});

	test('emits RSS feeds with per-feed filter, sort, render, and attach rules', async () => {
		let writes: Record<string, string> = {};
		let plugin = feed([{
			path: '/blog/feed.xml',
			title: 'Blog Feed',
			attach: '/blog/',
			filter: item => item.section === 'blog',
			sort: items => items.sort((a, b) => String(b.params.date).localeCompare(String(a.params.date))),
			render: item => ({
				title: item.title,
				url: item.url,
				summary: item.summary,
				date: item.params.date,
			}),
		}]);
		let pages = [
			page('/', { title: 'Home' }),
			page('/blog/old/', { title: 'Old', summary: 'Older post', date: '2024-01-01' }),
			page('/blog/new/', { title: 'New', summary: 'Newer post', date: '2025-01-01' }),
		];
		let tags: Template.TagEntry[] = [];

		await plugin.$hooks!.pages!({
			config: {
				$site: { title: 'Example', url: 'https://example.com/', lang: 'en' },
			},
			pages,
			sections: new Map(),
			tags,
		});
		await plugin.$hooks!.output!({
			config: {
				$site: { title: 'Example', url: 'https://example.com/', lang: 'en' },
			},
			pages,
			sections: new Map(),
			tags,
			write(file, contents) {
				writes[file] = String(contents);
			},
		});

		expect(pages[0].feeds).toBeUndefined();
		expect(pages[1].feeds).toEqual([{
			format: 'rss',
			path: '/blog/feed.xml',
			title: 'Blog Feed',
			type: 'application/rss+xml',
			url: 'https://example.com/blog/feed.xml',
		}]);
		expect(writes['/blog/feed.xml']).toContain('<rss version="2.0"');
		expect(writes['/blog/feed.xml']).toContain('<title>Blog Feed</title>');
		expect(writes['/blog/feed.xml'].indexOf('<title>New</title>')).toBeLessThan(writes['/blog/feed.xml'].indexOf('<title>Old</title>'));
		expect(writes['/blog/feed.xml']).not.toContain('<title>Home</title>');
	});

	test('supports atom and jsonl feed formats', async () => {
		let writes: Record<string, string> = {};
		let plugin = feed([
			{
				format: 'atom',
				path: '/blog/atom.xml',
				title: 'Atom Feed',
				attach: '/blog/',
				filter: item => item.section === 'blog',
			},
			{
				format: 'jsonl',
				path: '/blog/feed.jsonl',
				title: 'JSON Feed',
				attach: '/blog/',
				filter: item => item.section === 'blog',
			},
		]);
		let pages = [
			page('/blog/post/', { title: 'Post', summary: 'Hello', date: '2025-01-01' }),
		];
		let tags: Template.TagEntry[] = [];
		let config = {
			$site: { title: 'Example', url: 'https://example.com/', lang: 'en' },
		};

		await plugin.$hooks!.output!({
			config,
			pages,
			sections: new Map(),
			tags,
			write(file, contents) {
				writes[file] = String(contents);
			},
		});

		expect(writes['/blog/atom.xml']).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(writes['/blog/atom.xml']).toContain('<entry>');
		expect(writes['/blog/feed.jsonl']).toBe(JSON.stringify({
			title: 'Post',
			url: 'https://example.com/blog/post/',
			summary: 'Hello',
			date: '2025-01-01',
		}) + '\n');
	});
});
