import { beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from './build';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';

beforeEach(() => {
	bundler.reset();
	templates.Layouts.clear();
	templates.Partials.clear();
});

async function site(files: Record<string, string>): Promise<string> {
	let root = join(tmpdir(), `bongo-build-${randomBytes(6).toString('hex')}`);
	let all: Record<string, string> = {
		'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
		'layouts/html.hbs': '<html>{{{ $page.content }}}</html>',
		...files,
	};
	for (let [rel, text] of Object.entries(all)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), text);
	}
	return root;
}

function read(root: string, rel: string): Promise<string> {
	return readFile(join(root, 'public', rel), 'utf8');
}

describe('output files', () => {
	test('a <name>.<ext>.hbs file renders to its own path, with no layout, from the context of .hbs content', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $utils: { up: s => s.toUpperCase() } };`,
			'data/meta.json': '{ "owner": "luke" }',
			'content/index.html': '<p>home</p>',
			'content/blog/a.html': '---\ntitle: A\n---\n<p>a</p>',
			'content/blog/b.html': '---\ntitle: B\n---\n<p>b</p>',
			'content/sitemap.xml.hbs': [
				'---',
				'title: Map',
				'---',
				'<?xml version="1.0"?>',
				'<urlset owner="{{ $data.meta.owner }}" title="{{ $utils.up(params.title) }}" at="{{ $page.path }}" url="{{ $page.url }}">',
				'{{#each $pages as p}}',
				'<url>{{ p.url }}</url>',
				'{{/each}}',
				'</urlset>',
				'',
			].join('\n'),
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'sitemap.xml')).toBe([
				'<?xml version="1.0"?>',
				'<urlset owner="luke" title="MAP" at="/sitemap.xml" url="https://example.com/sitemap.xml">',
				'<url>https://example.com/</url>',
				'<url>https://example.com/blog/a/</url>',
				'<url>https://example.com/blog/b/</url>',
				'</urlset>',
			].join('\n'));
			expect(existsSync(join(root, 'public/sitemap.xml/index.html'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an output file sees its section, and no page lists an output file in $pages, $section, or $tags', async () => {
		let root = await site({
			'content/blog/index.hbs': '<ul>{{#each $section as p}}<li>{{ p.path }}</li>{{/each}}</ul><b>{{ $pages.length }}</b><s>{{ $tags.length }}</s>',
			'content/blog/post.html': '<p>post</p>',
			'content/blog/index.xml.hbs': '---\ntags: [feed]\n---\n<feed>{{#each $section as p}}<i>{{ p.path }}</i>{{/each}}</feed>\n',
			'content/robots.txt.hbs': 'Sitemap: {{ $site.url }}sitemap.xml\n',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'blog/index.html')).toBe('<html><ul><li>/blog/</li><li>/blog/post/</li></ul><b>2</b><s>0</s></html>');
			expect(await read(root, 'blog/index.xml')).toBe('<feed><i>/blog/</i><i>/blog/post/</i></feed>');
			expect(await read(root, 'robots.txt')).toBe('Sitemap: https://example.com/sitemap.xml');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an output file is written as rendered: no <bongo:*> rewrites, no content images, no dev reload script', async () => {
		let source = '<bongo:style src="style.css" /> <img src="photo.png" alt=""> <i transition:name="x"></i>';
		let root = await site({
			'assets/style.css': 'b { color: red }',
			'content/index.html': '<p>home</p>',
			'content/notes.txt.hbs': source,
		});
		try {
			await build({ cwd: root, dev: true });
			expect(await read(root, 'notes.txt')).toBe(source);
			expect(await read(root, 'index.html')).toContain('EventSource');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('{{ }} escapes text into well-formed XML', async () => {
		let root = await site({
			'content/t.xml.hbs': '---\ntitle: "Use <slot> & \\"friends\\""\n---\n<t a="{{ params.title }}">{{ params.title }}</t>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 't.xml')).toBe('<t a="Use &lt;slot> &amp; &quot;friends&quot;">Use &lt;slot> &amp; &quot;friends&quot;</t>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a .html.hbs file is still a page', async () => {
		let root = await site({
			'content/about.html.hbs': '<p>{{ $pages.length }}</p>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'about.html/index.html')).toBe('<html><p>1</p></html>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an output file may not set a custom url', async () => {
		let root = await site({
			'content/feed.xml.hbs': '---\nurl: /other.xml\n---\n<feed/>',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('content/feed.xml.hbs: Custom `url` is not allowed on output files; rename the file instead');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('--minify never passes an output file to the HTML minifier', async () => {
		let root = await site({
			'content/index.html': '<p>home  page</p>',
			'content/feed.xml.hbs': '<feed>  spaced  </feed>',
		});
		let bin = await mkdtemp(join(tmpdir(), 'bongo-path-'));
		let calls = join(bin, 'calls.log');
		await writeFile(join(bin, 'minify'), [
			'#!/bin/sh',
			`echo "$@" >> "${calls}"`,
			'[ "$1" = "--version" ] && { echo "minify v0.0.0"; exit 0; }',
			'for f in "$@"; do case "$f" in -*) ;; *) /usr/bin/tr -s " " < "$f" > "$f.tmp" && /bin/mv "$f.tmp" "$f";; esac; done',
		].join('\n'), { mode: 0o755 });
		let path = process.env.PATH;
		process.env.PATH = bin;
		try {
			await build({ cwd: root, minify: true });
			expect(await read(root, 'index.html')).toBe('<html><p>home page</p></html>');
			expect(await read(root, 'feed.xml')).toBe('<feed>  spaced  </feed>');
			let args = (await readFile(calls, 'utf8')).trim().split('\n').at(-1)!.split(' ');
			expect(args.slice(2)).toEqual([join(root, 'public/index.html')]);
		} finally {
			process.env.PATH = path;
			await rm(root, { recursive: true, force: true });
			await rm(bin, { recursive: true, force: true });
		}
	});

	test('a narrow rebuild renders every output file again from all pages, and leaves other pages alone', async () => {
		let root = await site({
			'content/a.html': '---\ntitle: A\n---\n<p>a</p>',
			'content/b.html': '---\ntitle: B\n---\n<p>b</p>',
			'content/list.txt.hbs': '{{#each $pages as p}}{{ p.title }};{{/each}}',
		});
		let mtime = async (rel: string) => (await stat(join(root, 'public', rel))).mtimeMs;
		try {
			await build({ cwd: root });
			expect(await read(root, 'list.txt')).toBe('A;B;');
			let list = await mtime('list.txt');
			let sibling = await mtime('b/index.html');

			await new Promise(r => setTimeout(r, 20));
			await writeFile(join(root, 'content/a.html'), '---\ntitle: A\n---\n<p>a, edited</p>');
			await build({ cwd: root }, { only: 'a.html' });
			expect(await read(root, 'a/index.html')).toContain('a, edited');
			expect(await read(root, 'list.txt')).toBe('A;B;');
			expect(await mtime('list.txt')).toBeGreaterThan(list);
			expect(await mtime('b/index.html')).toBe(sibling);

			await writeFile(join(root, 'content/list.txt.hbs'), '{{#each $pages as p}}[{{ p.title }}]{{/each}}');
			await build({ cwd: root }, { only: 'list.txt.hbs' });
			expect(await read(root, 'list.txt')).toBe('[A][B]');
			expect(await mtime('b/index.html')).toBe(sibling);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('$hooks.transform', () => {
	test('changes each page, after its asset links resolve, and each output file, and knows what each one is', async () => {
		let root = await site({
			'bongo.config.ts': [
				`export default {`,
				`	$site: { url: 'https://example.com/', title: 'T', lang: 'en' },`,
				`	$hooks: {`,
				`		transform(text, ctx) {`,
				`			let { kind, path, params, outputs } = ctx;`,
				`			return text + '|' + JSON.stringify({ kind, path, params, outputs, title: ctx.config.$site.title, placeholders: text.includes('__BONGO_BUNDLE') });`,
				`		},`,
				`	},`,
				`};`,
			].join('\n'),
			'assets/style.css': 'b { color: red }',
			'content/index.html': '---\ntitle: Home\n---\n<bongo:style src="style.css" />',
			'content/z.txt.hbs': 'z',
			'content/feed.xml.hbs': '---\nformat: rss\n---\n<feed/>',
		});
		let outputs = [{ path: '/feed.xml', params: { format: 'rss' } }, { path: '/z.txt', params: {} }];
		let info = async (rel: string) => JSON.parse((await read(root, rel)).split('|')[1]);
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toMatch(/^<html>\n<link rel="stylesheet" href="\/style\.[\w-]+\.css"\/><\/html>\|/);
			expect(await info('index.html')).toEqual({ kind: 'page', path: '/', params: { title: 'Home' }, outputs, title: 'T', placeholders: false });
			expect(await read(root, 'feed.xml')).toStartWith('<feed/>|');
			expect(await info('feed.xml')).toEqual({ kind: 'output', path: '/feed.xml', params: { format: 'rss' }, outputs, title: 'T', placeholders: false });

			await build({ cwd: root }, { only: 'index.html' });
			expect((await info('index.html')).outputs).toEqual(outputs);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an error fails the build and names the file and the layouts that rendered it', async () => {
		let config = (path: string) => `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $hooks: { transform(text, ctx) { if (ctx.path === '${path}') throw new Error('no thanks'); return text; } } };`;
		let root = await site({
			'bongo.config.ts': config('/blog/'),
			'content/blog/index.html': '<p>blog</p>',
			'content/list.txt.hbs': 'list',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('no thanks, rendering content/blog/index.html → layouts/html.hbs');
			await writeFile(join(root, 'bongo.config.ts'), config('/list.txt'));
			await expect(build({ cwd: root })).rejects.toThrow('no thanks, rendering content/list.txt.hbs');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a failed dev rebuild writes nothing, so the last good build keeps serving', async () => {
		let config = (version: string, path: string) => `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $hooks: { transform(text, ctx) { if (ctx.path === '${path}') throw new Error('no thanks'); return text + '${version}'; } } };`;
		let root = await site({
			'bongo.config.ts': config('v1', ''),
			'content/index.html': '<p>home</p>',
			'content/blog/index.html': '<p>blog</p>',
			'content/list.txt.hbs': 'list',
		});
		try {
			await build({ cwd: root, dev: true });
			await writeFile(join(root, 'bongo.config.ts'), config('v2', '/blog/'));
			await expect(build({ cwd: root, dev: true })).rejects.toThrow('no thanks');
			expect(await read(root, 'index.html')).toEndWith('</script>v1');
			expect(await read(root, 'blog/index.html')).toEndWith('</script>v1');
			expect(await read(root, 'list.txt')).toBe('listv1');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
