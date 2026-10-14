import { beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from '../../bongo/src/build';
import * as bundler from '../../bongo/src/utils/bundler';
import * as templates from '../../bongo/src/utils/templates';
import { feed } from './index';

import type { Build, Config, Template } from 'bongo';

function config(url = 'https://example.com'): Required<Config> {
	return {
		$site: { url, lang: 'en', title: 'Test Site', description: '', menu: {} },
		$utils: {},
		$loaders: {},
		$partials: {},
		$build: {},
		$images: {},
		$hooks: {},
		plugins: [],
	};
}

function page(outputs: Build.File[], url?: string): Build.Context {
	return { kind: 'page', path: '/', params: {}, outputs, config: config(url) };
}

function output(params: Template.Params, path = '/feed.xml', url?: string): Build.Context {
	return { kind: 'output', path, params, outputs: [{ path, params }], config: config(url) };
}

async function run(text: string, ctx: Build.Context): Promise<string> {
	let transform = feed().$hooks?.transform;
	if (!transform) throw new Error('feed() did not set $hooks.transform');
	return transform(text, ctx);
}

describe('<feed:link>', () => {
	test('emits RSS MIME for an rss-format target', async () => {
		let out = await run(`<head><feed:link path="/blog/feed.xml" /></head>`, page([{ path: '/blog/feed.xml', params: { format: 'rss', title: 'Blog' } }]));
		expect(out).toBe('<head><link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/feed.xml"/></head>');
	});

	test('emits Atom MIME for an atom-format target (format-flip)', async () => {
		let out = await run(`<feed:link path="/blog/feed.xml" />`, page([{ path: '/blog/feed.xml', params: { format: 'atom', title: 'Blog' } }]));
		expect(out).toContain('type="application/atom+xml"');
	});

	test('takes a title attribute over the target title, and reads a typed title as text', async () => {
		let outputs = [{ path: '/feed.xml', params: { format: 'rss', title: 2024 } }];
		expect(await run(`<feed:link path="/feed.xml" />`, page(outputs))).toContain('title="2024"');
		expect(await run(`<feed:link path="/feed.xml" title="News &amp; notes" />`, page(outputs))).toContain('title="News &amp; notes"');
	});

	test('links under the subfolder of $site.url, as asset links do', async () => {
		let out = await run(`<feed:link path="/blog/feed.xml" />`, page([{ path: '/blog/feed.xml', params: { format: 'rss', title: 'Blog' } }], 'https://example.com/sub'));
		expect(out).toContain('href="/sub/blog/feed.xml"');
	});

	test('errors when the target is not an output file', async () => {
		await expect(run(`<feed:link path="/blog/missing.xml" />`, page([]))).rejects.toThrow('<feed:link path="/blog/missing.xml"> target not found; a feed is an output file, such as content/blog/missing.xml.hbs');
	});

	test('errors when the target is missing format frontmatter', async () => {
		await expect(run(`<feed:link path="/blog/broken.xml" />`, page([{ path: '/blog/broken.xml', params: {} }]))).rejects.toThrow(/missing required "format/);
		await expect(run(`<feed:link path="/blog/broken.xml" />`, page([{ path: '/blog/broken.xml', params: { format: 'json' } }]))).rejects.toThrow(/missing required "format/);
	});

	test('errors when "path" attribute is missing', async () => {
		await expect(run(`<feed:link />`, page([]))).rejects.toThrow(/missing required "path"/);
	});

	test('errors on unknown attributes', async () => {
		await expect(run(`<feed:link path="/feed.xml" rel="self" />`, page([{ path: '/feed.xml', params: { format: 'rss' } }]))).rejects.toThrow(/unknown attribute "rel"/);
	});

	test('leaves output files that are not feeds alone', async () => {
		let text = '<urlset><feed:link path="/feed.xml" /></urlset>';
		expect(await run(text, output({}, '/sitemap.xml'))).toBe(text);
	});
});

const BODY = `<feed:channel>
<feed:item href="https://example.com/p/a/" title="Post A" date="2025-01-15T10:00:00Z" summary="first" />
<feed:item href="https://example.com/p/b/" title="Post B" date="2025-02-20T10:00:00Z" />
</feed:channel>`;

describe('<feed:channel> RSS', () => {
	test('produces well-formed RSS 2.0', async () => {
		let out = await run(BODY, output({ format: 'rss', title: 'Test Feed', description: 'desc', language: 'en', copyright: '(c) 2025' }));

		expect(out).toStartWith('<?xml version="1.0" encoding="utf-8"?>\n');
		expect(out).toContain('<rss version="2.0"');
		expect(out).toContain('<title>Test Feed</title>');
		expect(out).toContain('<description>desc</description>');
		expect(out).toContain('<language>en</language>');
		expect(out).toContain('<copyright>(c) 2025</copyright>');
		expect(out).toContain('<atom:link href="https://example.com/feed.xml" rel="self"');
		expect(out).toContain('<title>Post A</title>');
		expect(out).toContain('<link>https://example.com/p/a/</link>');
		expect(out).toContain('<pubDate>Wed, 15 Jan 2025 10:00:00 GMT</pubDate>');
		expect(out).toContain('<description>first</description>');
		expect(out.substring(out.indexOf('<title>Post B</title>'))).not.toContain('<description>');
	});
});

describe('<feed:channel> link', () => {
	test('defaults to $site.url, or takes a path or a URL from frontmatter `link`', async () => {
		expect(await run(BODY, output({ format: 'rss', title: 'T' }))).toContain('<link>https://example.com/</link>');
		expect(await run(BODY, output({ format: 'rss', title: 'T', link: '/blog/' }))).toContain('<link>https://example.com/blog/</link>');
		expect(await run(BODY, output({ format: 'atom', title: 'T', link: '/blog/' }))).toContain('<link rel="alternate" href="https://example.com/blog/"/>');
		expect(await run(BODY, output({ format: 'rss', title: 'T', link: 'https://other.example/' }))).toContain('<link>https://other.example/</link>');
		expect(await run(BODY, output({ format: 'rss', title: 'T', link: '/blog/' }, '/feed.xml', 'https://my.example/sub/'))).toContain('<link>https://my.example/sub/blog/</link>');
	});
});

describe('<feed:channel> RSS lastBuildDate', () => {
	test('is the latest item date, as Atom <updated> is, and is left out of an empty feed', async () => {
		expect(await run(BODY, output({ format: 'rss', title: 'T' }))).toContain('<lastBuildDate>Thu, 20 Feb 2025 10:00:00 GMT</lastBuildDate>\n<atom:link');
		expect(await run('<feed:channel></feed:channel>', output({ format: 'rss', title: 'T' }))).not.toContain('<lastBuildDate>');
	});
});

describe('<feed:channel> Atom — same body, format-flip', () => {
	test('produces well-formed Atom 1.0 from the same channel block', async () => {
		let out = await run(BODY, output({ format: 'atom', title: 'Test Feed', subtitle: 'sub', language: 'en' }));

		expect(out).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
		expect(out).toContain('<title>Test Feed</title>');
		expect(out).toContain('<subtitle>sub</subtitle>');
		expect(out).toContain('<id>https://example.com/feed.xml</id>');
		expect(out).toContain('<link rel="self" href="https://example.com/feed.xml"');
		expect(out).toContain('<entry>');
		expect(out).toContain('<title>Post A</title>');
		expect(out).toContain('<link href="https://example.com/p/a/"/>');
		expect(out).toContain('<updated>2025-02-20T10:00:00.000Z</updated>\n<entry>');
	});

	test('names a feed author, which entries without their own need, from frontmatter or $site.title', async () => {
		let out = await run(BODY, output({ format: 'atom', title: 'T' }));
		expect(out).toContain('<author><name>Test Site</name></author>\n<updated>');
		out = await run(BODY, output({ format: 'atom', title: 'T', author: 'Luke & co' }));
		expect(out).toContain('<author><name>Luke &amp; co</name></author>\n<updated>');
	});

	test('reads format with any case and spacing', async () => {
		expect(await run(BODY, output({ format: ' Atom ', title: 'T' }))).toContain('<entry>');
	});
});

describe('<feed:channel> stylesheet', () => {
	let second = (out: string) => out.split('\n')[1];

	test('links a CSS or XSL stylesheet from frontmatter, so browsers can show the feed as a page', async () => {
		expect(second(await run(BODY, output({ format: 'rss', title: 'T', stylesheet: '/blog/feed.css' })))).toBe('<?xml-stylesheet type="text/css" href="/blog/feed.css"?>');
		expect(second(await run(BODY, output({ format: 'atom', title: 'T', stylesheet: '/feed.xsl' })))).toBe('<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>');
	});

	test('links under the subfolder of $site.url, and keeps a full URL as written', async () => {
		expect(second(await run(BODY, output({ format: 'rss', title: 'T', stylesheet: '/feed.css' }, '/feed.xml', 'https://example.com/sub/')))).toBe('<?xml-stylesheet type="text/css" href="/sub/feed.css"?>');
		expect(second(await run(BODY, output({ format: 'rss', title: 'T', stylesheet: 'https://cdn.example/feed.css?v=1&x=2' })))).toBe('<?xml-stylesheet type="text/css" href="https://cdn.example/feed.css?v=1&amp;x=2"?>');
	});

	test('is left out by default', async () => {
		expect(await run(BODY, output({ format: 'rss', title: 'T' }))).not.toContain('xml-stylesheet');
	});

	test('errors on a stylesheet that is neither CSS nor XSL', async () => {
		await expect(run(BODY, output({ format: 'rss', title: 'T', stylesheet: '/feed.js' }))).rejects.toThrow('<feed:channel> "stylesheet" must be a .css or .xsl file: "/feed.js"');
	});
});

describe('<feed:channel> errors', () => {
	test('errors when the feed has no <feed:channel>', async () => {
		await expect(run('<feed:item href="/x" title="t" date="2025-01-01" />', output({ format: 'rss', title: 'T' }))).rejects.toThrow('A feed must contain a <feed:channel>...</feed:channel> block');
	});

	test('errors when a file has a <feed:channel> but no valid format', async () => {
		let message = '<feed:channel> needs "format: rss" or "format: atom" in its frontmatter';
		await expect(run('<feed:channel></feed:channel>', output({ title: 'T' }))).rejects.toThrow(message);
		await expect(run('<feed:channel></feed:channel>', output({ title: 'T', format: 'json' }))).rejects.toThrow(message);
	});

	test('errors on attributes, which <feed:channel> does not take', async () => {
		await expect(run('<feed:channel title="T"></feed:channel>', output({ format: 'rss', title: 'T' }))).rejects.toThrow('<feed:channel> unknown attribute "title"; set it in the frontmatter');
	});

	test('errors when the feed has no title', async () => {
		await expect(run('<feed:channel></feed:channel>', output({ format: 'rss' }))).rejects.toThrow('<feed:channel> "/feed.xml" missing required "title" in frontmatter');
	});
});

describe('<feed:item> attribute validation', () => {
	let rss = (body: string) => run(`<feed:channel>${body}</feed:channel>`, output({ format: 'rss', title: 'T' }));

	test('errors when href is missing', async () => {
		await expect(rss('<feed:item title="t" date="2025-01-01" />')).rejects.toThrow(/missing required "href"/);
	});

	test('errors when title is missing', async () => {
		await expect(rss('<feed:item href="/x" date="2025-01-01" />')).rejects.toThrow(/missing required "title"/);
	});

	test('errors when date is missing', async () => {
		await expect(rss('<feed:item href="/x" title="t" />')).rejects.toThrow(/missing required "date"/);
	});

	test('errors on unknown attributes', async () => {
		await expect(rss('<feed:item href="/x" title="t" date="2025-01-01" guid="oops" />')).rejects.toThrow(/unknown attribute "guid"/);
	});

	test('errors when date is not a valid date', async () => {
		await expect(rss('<feed:item href="/x" title="t" date="last tuesday" />')).rejects.toThrow('<feed:item> "date" is not a valid date: "last tuesday"');
	});

	test('omits optional elements when their attribute is absent', async () => {
		let out = await rss('<feed:item href="/x" title="t" date="2025-01-01" />');
		expect(out).not.toContain('<author>');
		expect(out).not.toContain('<category>');
		expect(out).not.toContain('<content:encoded>');
		expect(out.substring(out.indexOf('<item>'), out.indexOf('</item>'))).not.toContain('<description>');
	});

	test('emits author as dc:creator, since RSS <author> must be an email address, and tags', async () => {
		let out = await rss('<feed:item href="/x" title="t" date="2025-01-01" author="Jane" tags="a, b, c" />');
		expect(out).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">');
		expect(out).toContain('<dc:creator>Jane</dc:creator>');
		expect(out).not.toContain('<author>');
		expect(out).toContain('<category>a</category>\n<category>b</category>\n<category>c</category>');
	});

	test('emits content:encoded with CDATA for RSS, and declares its namespace', async () => {
		let out = await rss('<feed:item href="/x" title="t" date="2025-01-01" content="&lt;p&gt;Hi ]]&gt; there&lt;/p&gt;" />');
		expect(out).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">');
		expect(out).toContain('<content:encoded><![CDATA[<p>Hi ]]]]><![CDATA[> there</p>]]></content:encoded>');
	});

	test('declares only the namespaces it uses', async () => {
		let out = await rss('<feed:item href="/x" title="t" date="2025-01-01" />');
		expect(out).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
	});

	test('emits <content type="html"> for Atom', async () => {
		let out = await run('<feed:channel><feed:item href="/x" title="t" date="2025-01-01" content="&lt;p&gt;some html&lt;/p&gt;" /></feed:channel>', output({ format: 'atom', title: 'T' }));
		expect(out).toContain('<content type="html">&lt;p&gt;some html&lt;/p&gt;</content>');
	});
});

describe('XML escaping', () => {
	test('escapes special chars in attribute values exactly once', async () => {
		let out = await run('<feed:channel><feed:item href="https://x/?a=1&amp;b=2" title="A &amp; B &lt;ok&gt; &amp;amp;" date="2025-01-01" /></feed:channel>', output({ format: 'rss', title: 'T' }));
		expect(out).toContain('<title>A &amp; B &lt;ok&gt; &amp;amp;</title>');
		expect(out).toContain('https://x/?a=1&amp;b=2');
	});
});

describe('quoted attribute values', () => {
	test('may contain > and />, as {{ }} leaves > unescaped', async () => {
		let out = await run('<feed:channel><feed:item href="/x" title="a -> b />" date="2025-01-01" summary=\'1 > 0\'></feed:item></feed:channel>', output({ format: 'rss', title: 'T' }));
		expect(out).toContain('<title>a -&gt; b /&gt;</title>');
		expect(out).toContain('<description>1 &gt; 0</description>');
		let link = await run('<feed:link path="/feed.xml" title="a > b" />!', page([{ path: '/feed.xml', params: { format: 'rss' } }]));
		expect(link).toBe('<link rel="alternate" type="application/rss+xml" title="a &gt; b" href="/feed.xml"/>!');
	});
});

describe('empty feeds', () => {
	test('Atom <updated> falls back to current time, never 1970 epoch', async () => {
		let before = Date.now();
		let out = await run('<feed:channel></feed:channel>', output({ format: 'atom', title: 'T' }));
		let stamp = Date.parse(/<updated>([^<]+)<\/updated>/.exec(out)?.[1] ?? '');
		expect(stamp).toBeGreaterThanOrEqual(before - 1000);
		expect(stamp).toBeLessThanOrEqual(Date.now());
	});
});

describe('URL inference', () => {
	test('the feed URL and item paths keep a subpath in $site.url', async () => {
		let out = await run('<feed:channel><feed:item href="/blog/a/" title="A" date="2025-01-01" /></feed:channel>', output({ format: 'rss', title: 'T' }, '/blog/feed.xml', 'https://my.example/sub/'));
		expect(out).toContain('<atom:link href="https://my.example/sub/blog/feed.xml"');
		expect(out).toContain('<link>https://my.example/sub/blog/a/</link>');
	});
});

describe('with bongo build', () => {
	beforeEach(() => {
		bundler.reset();
		templates.Layouts.clear();
		templates.Partials.clear();
	});

	let FEED = [
		'---',
		'format: rss',
		'title: Blog Feed',
		'description: Posts from the blog',
		'language: en',
		'copyright: (c) 2025 example',
		'---',
		'<feed:channel>',
		'{{#each $section.filter(p => p.params.date) as post}}',
		'<feed:item href="{{ post.path }}" title="{{ post.title }}" date="{{ post.params.date }}" summary="{{ post.summary }}" />',
		'{{/each}}',
		'</feed:channel>',
	].join('\n');

	async function site(): Promise<string> {
		let root = join(tmpdir(), `bongo-feed-${randomBytes(6).toString('hex')}`);
		let files: Record<string, string> = {
			'bongo.config.ts': [
				`import { feed } from ${JSON.stringify(join(import.meta.dirname, 'index'))};`,
				`export default { $site: { url: 'https://example.com', title: 'Feed Tags Fixture', lang: 'en' }, plugins: [feed()] };`,
			].join('\n'),
			'layouts/html.hbs': '<!doctype html>\n<html lang="{{ $site.lang }}">\n<head>\n<title>{{ $page.title }}</title>\n<feed:link path="/blog/feed.xml" />\n</head>\n<body>\n{{{ $page.content }}}\n</body>\n</html>\n',
			'content/index.html': '<h1>Home</h1>',
			'content/blog/post-a.html': '---\ntitle: Post A\nsummary: First post\ndate: 2025-01-15T10:00:00Z\n---\n<h1>Post A</h1>',
			'content/blog/post-b.html': '---\ntitle: Post B & "Friends" \\ <co> -> 1\nsummary: Second post\ndate: 2025-02-20T10:00:00Z\n---\n<h1>Post B</h1>',
			'content/blog/feed.xml.hbs': FEED,
		};
		for (let [rel, text] of Object.entries(files)) {
			await mkdir(join(root, rel, '..'), { recursive: true });
			await writeFile(join(root, rel), text);
		}
		return root;
	}

	let read = (root: string, rel: string) => readFile(join(root, 'public', rel), 'utf8');

	test('writes the feed as RSS at its own path, and a link to it on every page', async () => {
		let root = await site();
		try {
			await build({ cwd: root });
			let xml = await read(root, 'blog/feed.xml');
			expect(xml).toStartWith('<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"');
			expect(xml).toContain('<title>Blog Feed</title>');
			expect(xml).toContain('<description>Posts from the blog</description>');
			expect(xml).toContain('<atom:link href="https://example.com/blog/feed.xml" rel="self" type="application/rss+xml"/>');
			expect(xml).toContain('<title>Post A</title>\n<link>https://example.com/blog/post-a/</link>');
			expect(xml).toContain('<title>Post B &amp; &quot;Friends&quot; \\ &lt;co&gt; -&gt; 1</title>');
			expect(xml).not.toContain('<feed:');
			expect(xml).not.toContain('<html');

			let home = await read(root, 'index.html');
			expect(home).toContain('<link rel="alternate" type="application/rss+xml" title="Blog Feed" href="/blog/feed.xml"/>');
			expect(home).not.toContain('<feed:');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('format-flip: same body file, atom frontmatter -> atom output and atom MIME', async () => {
		let root = await site();
		try {
			await writeFile(join(root, 'content/blog/feed.xml.hbs'), FEED.replace('format: rss', 'format: atom'));
			await build({ cwd: root });
			let xml = await read(root, 'blog/feed.xml');
			expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
			expect(xml).toContain('<entry>');
			expect(xml).not.toContain('<rss');
			let home = await read(root, 'index.html');
			expect(home).toContain('type="application/atom+xml"');
			expect(home).not.toContain('application/rss+xml');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a narrow rebuild of one post keeps every item in the feed', async () => {
		let root = await site();
		try {
			await build({ cwd: root });
			let before = await read(root, 'blog/feed.xml');
			expect(before.match(/<item>/g)).toHaveLength(2);

			await writeFile(join(root, 'content/blog/post-a.html'), '---\ntitle: Post A\nsummary: First post\ndate: 2025-01-15T10:00:00Z\n---\n<h1>Post A, edited</h1>');
			await build({ cwd: root }, { only: 'blog/post-a.html' });
			expect(await read(root, 'blog/post-a/index.html')).toContain('Post A, edited');
			expect(await read(root, 'blog/feed.xml')).toBe(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an error names the feed file', async () => {
		let root = await site();
		try {
			await writeFile(join(root, 'content/blog/feed.xml.hbs'), FEED.replace('date="{{ post.params.date }}" ', ''));
			await expect(build({ cwd: root })).rejects.toThrow('<feed:item> missing required "date" attribute, rendering content/blog/feed.xml.hbs');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
