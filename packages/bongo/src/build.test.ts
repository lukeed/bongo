import { beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build, imports } from './build';
import * as bundler from './utils/bundler';
import { ID, RELOAD } from './utils/http';
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
			expect(await read(root, 'index.html')).toContain(`${RELOAD}?id=${ID}`);
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

	test('only a second extension with a known content type makes an output file', async () => {
		let root = await site({
			'content/v1.2.hbs': '<p>{{ $pages.length }}</p>',
			'content/robots.txt.hbs': 'User-agent: *',
			'content/manifest.webmanifest.hbs': '{ "name": "{{ $site.title }}" }',
			'content/logo.svg.hbs': '<svg/>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'v1.2/index.html')).toBe('<html><p>1</p></html>');
			expect(await read(root, 'robots.txt')).toBe('User-agent: *');
			expect(await read(root, 'manifest.webmanifest')).toBe('{ "name": "T" }');
			expect(await read(root, 'logo.svg')).toBe('<svg/>');
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

describe('data modules', () => {
	test('a <name>.json.ts file writes its default export as compact JSON, from the context of .hbs content', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $utils: { up: s => s.toUpperCase() } };`,
			'data/meta.json': '{ "owner": "luke" }',
			'content/index.html': '<p>home</p>',
			'content/blog/a.html': '---\ntitle: A\ntags: x\n---\n<p>a</p>',
			'content/blog/b.html': '---\ntitle: B\n---\n<p>b</p>',
			'content/blog/posts.json.ts': [
				'type Page = { path: string; title: string };',
				'export default async ({ $site, $pages, $section, $tags, $data, $utils }: Record<string, any>) => ({',
				'	site: $site.title,',
				'	owner: $data.meta.owner,',
				'	up: $utils.up("x"),',
				'	pages: $pages.map((p: Page) => p.path),',
				'	section: $section.map((p: Page) => p.title),',
				'	tags: $tags.map((t: { tag: string }) => t.tag),',
				'});',
			].join('\n'),
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'blog/posts.json')).toBe(JSON.stringify({
				site: 'T',
				owner: 'luke',
				up: 'X',
				pages: ['/', '/blog/a/', '/blog/b/'],
				section: ['A', 'B'],
				tags: ['x'],
			}));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a module may export a plain value, and a .json.js file works too', async () => {
		let root = await site({
			'content/index.html': '<p>home</p>',
			'content/a.json.ts': 'export default [1, { two: 2 }];',
			'content/b.json.js': 'export default "three";',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'a.json')).toBe('[1,{"two":2}]');
			expect(await read(root, 'b.json')).toBe('"three"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a data module is not a page, and no page lists it', async () => {
		let root = await site({
			'content/index.html': '<p>home</p>',
			'content/list.txt.hbs': '{{#each $pages as p}}{{ p.path }};{{/each}}',
			'content/data.json.ts': 'export default { ok: true };',
		});
		try {
			await build({ cwd: root, minify: true });
			expect(await read(root, 'list.txt')).toBe('/;');
			expect(await read(root, 'data.json')).toBe('{"ok":true}');
			expect(existsSync(join(root, 'public/data.json.ts'))).toBe(false);
			expect(existsSync(join(root, 'public/data.json/index.html'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a narrow rebuild runs every data module again', async () => {
		let root = await site({
			'content/a.html': '---\ntitle: A\n---\n<p>a</p>',
			'content/titles.json.ts': 'export default ({ $pages }: Record<string, any>) => $pages.map((p: { title: string }) => p.title);',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'titles.json')).toBe('["A"]');
			await writeFile(join(root, 'content/a.html'), '---\ntitle: A2\n---\n<p>a</p>');
			await build({ cwd: root }, { only: 'a.html' });
			expect(await read(root, 'titles.json')).toBe('["A2"]');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a module with no default export, or one that throws, fails the build and names the file', async () => {
		for (let [source, message] of [
			['export const value = 1;', 'needs a default export'],
			['export default () => { throw new Error("boom"); };', 'boom'],
			['export default () => undefined;', 'is not JSON'],
		]) {
			let root = await site({ 'content/index.html': '<p>home</p>', 'content/bad.json.ts': source });
			try {
				let failed = await build({ cwd: root }).then(() => '', (err: Error) => err.message);
				expect(failed).toContain('content/bad.json.ts');
				expect(failed).toContain(message);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});

	test('lists the local files that data modules import from outside content/, for dev to watch', async () => {
		let root = await site({
			'lib/names.ts': 'export const names = ["a", "b"];',
			'content/index.html': '<p>home</p>',
			'content/names.json.ts': 'import { names } from "../lib/names";\nexport default names;',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'names.json')).toBe('["a","b"]');
			let files = imports().map(file => realpathSync(file));
			expect(files).toContain(realpathSync(join(root, 'lib/names.ts')));
			expect(files).not.toContain(realpathSync(join(root, 'content/names.json.ts')));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('urls', () => {
	test('page and output file urls keep the subfolder of $site.url', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/sub', title: 'T', lang: 'en' } };`,
			'layouts/html.hbs': '{{ $page.url }}',
			'content/index.html': '',
			'content/post.html': '',
			'content/urls.txt.hbs': '{{ $page.url }}{{#each $pages as p}} {{ p.url }}{{/each}}',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toBe('https://example.com/sub/');
			expect(await read(root, 'post/index.html')).toBe('https://example.com/sub/post/');
			expect(await read(root, 'urls.txt')).toBe('https://example.com/sub/urls.txt https://example.com/sub/ https://example.com/sub/post/');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a custom url sets the path of any page, index pages too', async () => {
		let root = await site({
			'layouts/html.hbs': '{{ $page.path }}',
			'content/docs/index.html': '---\nurl: /hello/\n---\n',
			'content/about.html': '---\nurl: team\n---\n',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'hello/index.html')).toBe('/hello/');
			expect(await read(root, 'team/index.html')).toBe('/team/');
			expect(existsSync(join(root, 'public/h'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a custom url that ends in a file name writes that file', async () => {
		let root = await site({
			'layouts/html.hbs': '{{ $page.path }} {{ $page.url }}',
			'content/404.html': '---\nurl: /404.html\n---\n',
			'content/docs/index.html': '---\nurl: /docs/v1.0/\n---\n',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, '404.html')).toBe('/404.html https://example.com/404.html');
			expect(await read(root, 'docs/v1.0/index.html')).toBe('/docs/v1.0/ https://example.com/docs/v1.0/');
			expect(existsSync(join(root, 'public/404'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('layouts', () => {
	test('a page uses the layouts of its nearest folder first', async () => {
		let root = await site({
			'layouts/html.hbs': '<html>{{{ $page.content }}}</html>',
			'layouts/blog/html.hbs': '<blog>{{{ $page.content }}}</blog>',
			'layouts/blog/single.hbs': 'blog/single',
			'layouts/blog/2025/single.hbs': 'blog/2025/single',
			'layouts/2025/single.hbs': '2025/single',
			'content/blog/2025/post.html': '',
			'content/blog/note.html': '',
			'content/2025/post.html': '',
			'content/news/2025/post.html': '',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'blog/2025/post/index.html')).toBe('<blog>blog/2025/single</blog>');
			expect(await read(root, 'blog/note/index.html')).toBe('<blog>blog/single</blog>');
			expect(await read(root, '2025/post/index.html')).toBe('<html>2025/single</html>');
			expect(await read(root, 'news/2025/post/index.html')).toBe('<html></html>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('layouts fallback', () => {
	test('a page without a single.hbs uses the index.hbs of its folder, before any html.hbs', async () => {
		let root = await site({
			'layouts/html.hbs': '<html>{{{ $page.content }}}</html>',
			'layouts/docs/index.hbs': 'docs/index',
			'layouts/docs/html.hbs': '<docs>{{{ $page.content }}}</docs>',
			'layouts/blog/index.hbs': 'blog/index',
			'layouts/blog/single.hbs': 'blog/single',
			'layouts/guide/2025/index.hbs': 'guide/2025/index',
			'layouts/guide/single.hbs': 'guide/single',
			'content/docs/index.html': '',
			'content/docs/intro.html': '',
			'content/blog/post.html': '',
			'content/guide/2025/step.html': '',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'docs/index.html')).toBe('<docs>docs/index</docs>');
			expect(await read(root, 'docs/intro/index.html')).toBe('<docs>docs/index</docs>');
			expect(await read(root, 'blog/post/index.html')).toBe('<html>blog/single</html>');
			expect(await read(root, 'guide/2025/step/index.html')).toBe('<html>guide/2025/index</html>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('partials', () => {
	test('a .hbs partial may read $slot without {{#expect}}', async () => {
		let root = await site({
			'partials/box.hbs': '<i>{{{ $slot }}}</i>',
			'layouts/html.hbs': '{{#partial src="box" $slot="hi"}}',
			'content/index.html': '',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toBe('<i>hi</i>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a .hbs partial that reads a name it does not declare fails with the fix', async () => {
		let root = await site({
			'partials/blog/meta.hbs': '<time>{{ date }}</time>',
			'layouts/html.hbs': '{{#partial src="blog/meta" date="2024"}}',
			'content/index.html': '',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('partials/blog/meta.hbs reads "date", but does not declare it. Add {{#expect date}} at the top of the partial.');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('content', () => {
	test('folders named partials or shortcodes hold pages too', async () => {
		let root = await site({
			'content/partials/a.html': '<p>a</p>',
			'content/docs/shortcodes/b.html': '<p>b</p>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'partials/a/index.html')).toBe('<html><p>a</p></html>');
			expect(await read(root, 'docs/shortcodes/b/index.html')).toBe('<html><p>b</p></html>');
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

describe('headings', () => {
	test('a loader gives the headings of a page to $page, $pages, $section, and data modules', async () => {
		let root = await site({
			'bongo.config.ts': [
				`export default {`,
				`	$site: { url: 'https://example.com/', title: 'T', lang: 'en' },`,
				`	$loaders: {`,
				`		txt: (file, content) => ({`,
				`			filename: file + '.html',`,
				`			content: '<h2 id="a">A</h2>',`,
				`			headings: [{ level: 2, id: 'a', text: 'A', html: '<code>A</code>' }, { level: 3, id: 'b', text: 'B & <c>' }],`,
				`		}),`,
				`	},`,
				`};`,
			].join('\n'),
			'layouts/html.hbs': '{{{ JSON.stringify([$page.headings, $section.map(p => p.headings.length), $pages.map(p => p.headings.length)]) }}}',
			'content/docs/a.txt': '',
			'content/docs/b.html': '<h2>Not parsed</h2>',
			'content/docs/list.json.ts': 'export default ({ $pages }) => $pages.map(page => [page.path, page.headings.map(h => h.id)]);',
		});
		try {
			await build({ cwd: root });
			let headings = [
				{ level: 2, id: 'a', text: 'A', html: '<code>A</code>' },
				{ level: 3, id: 'b', text: 'B & <c>', html: 'B &amp; &lt;c&gt;' },
			];
			expect(JSON.parse(await read(root, 'docs/a/index.html'))).toEqual([headings, [2, 0], [2, 0]]);
			expect(JSON.parse(await read(root, 'docs/b/index.html'))).toEqual([[], [2, 0], [2, 0]]);
			expect(JSON.parse(await read(root, 'docs/list.json'))).toEqual([['/docs/a/', ['a', 'b']], ['/docs/b/', []]]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
