import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
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

	test('a rebuild renders every output file again from all pages, and leaves other pages alone', async () => {
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
			await build({ cwd: root });
			expect(await read(root, 'a/index.html')).toContain('a, edited');
			expect(await read(root, 'list.txt')).toBe('A;B;');
			expect(await mtime('list.txt')).toBeGreaterThan(list);
			expect(await mtime('b/index.html')).toBe(sibling);

			await writeFile(join(root, 'content/list.txt.hbs'), '{{#each $pages as p}}[{{ p.title }}]{{/each}}');
			await build({ cwd: root });
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

	test('a rebuild runs every data module again', async () => {
		let root = await site({
			'content/a.html': '---\ntitle: A\n---\n<p>a</p>',
			'content/titles.json.ts': 'export default ({ $pages }: Record<string, any>) => $pages.map((p: { title: string }) => p.title);',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'titles.json')).toBe('["A"]');
			await writeFile(join(root, 'content/a.html'), '---\ntitle: A2\n---\n<p>a</p>');
			await build({ cwd: root });
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

	test('paths include the subfolder of $site.url, for pages, output files, data modules, and hooks', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/sub', title: 'T', lang: 'en' }, $hooks: { transform: (text, ctx) => ctx.kind === 'output' ? text + ' ' + ctx.path + ' ' + ctx.outputs.map(o => o.path).join() : text } };`,
			'layouts/html.hbs': '{{ $page.path }}|{{ $pages.map(p => p.path).join() }}',
			'content/index.html': '',
			'content/blog/post.html': '',
			'content/paths.txt.hbs': '{{ $page.path }}',
			'content/paths.json.ts': 'export default ({ $pages }) => $pages.map(p => p.path);',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toBe('/sub/|/sub/,/sub/blog/post/');
			expect(await read(root, 'blog/post/index.html')).toBe('/sub/blog/post/|/sub/,/sub/blog/post/');
			expect(await read(root, 'paths.txt')).toBe('/sub/paths.txt /sub/paths.txt /sub/paths.txt');
			expect(JSON.parse(await read(root, 'paths.json'))).toEqual(['/sub/', '/sub/blog/post/']);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('page images resolve as a browser resolves them, under the subfolder of $site.url', async () => {
		let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"></svg>';
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/sub/', title: 'T', lang: 'en' } };`,
			'content/post.html': '<img src="hero.svg" alt="a"><bongo:image src="/sub/post/hero.svg" alt="b" />',
			'content/post/hero.svg': svg,
		});
		try {
			await build({ cwd: root });
			let html = await read(root, 'post/index.html');
			let srcs = Array.from(html.matchAll(/src="([^"]+)"/g), m => m[1]);
			expect(srcs).toHaveLength(2);
			expect(srcs[0]).toMatch(/^\/sub\/hero\.[\w-]+\.svg$/);
			expect(srcs[1]).toBe(srcs[0]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a root-relative image outside the subfolder of $site.url fails the build', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/sub/', title: 'T', lang: 'en' } };`,
			'content/post.html': '<bongo:image src="/post/hero.svg" alt="" />',
			'content/post/hero.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('Image "/post/hero.svg" is outside the site at /sub/');
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

describe('$assets.load', () => {
	test('reads a file of assets/, and names a missing one', async () => {
		let root = await site({ 'layouts/html.hbs': '{{{ $page.content }}}', 'assets/hi.txt': 'hello', 'content/index.hbs': `{{ await $assets.load('hi.txt', 'utf8') }}` });
		try {
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('hello');
			await writeFile(join(root, 'content/index.hbs'), `{{ await $assets.load('none.txt') }}`);
			await expect(build({ cwd: root })).rejects.toThrow(/^Missing "none\.txt" asset!, rendering content\/index\.hbs$/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('scripts and styles', () => {
	test('an inline script builds alone, so it imports nothing, even when it shares code with another script', async () => {
		let root = await site({
			'assets/shared.ts': 'export function greet(name: string) { return document.title + " greets " + name; }',
			'assets/a.ts': 'import { greet } from "./shared";\nconsole.log(greet("a"));',
			'assets/b.ts': 'import { greet } from "./shared";\ndocument.body.dataset.b = greet("b");',
			'layouts/html.hbs': '{{{ $page.content }}}<bongo:script src="a.ts" /><bongo:script src="b.ts" inline />',
			'content/blog/post.html': '<p>post</p>',
		});
		try {
			await build({ cwd: root });
			let html = await read(root, 'blog/post/index.html');
			let inline = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
			expect(inline).toContain('greets');
			expect(inline).not.toContain('import');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('iife scripts build one at a time, with dynamic imports inlined', async () => {
		let root = await site({
			'assets/shared.ts': 'export function greet(name: string) { return document.title + " greets " + name; }',
			'assets/a.ts': 'import { greet } from "./shared";\nconsole.log(greet("a"));',
			'assets/b.ts': 'import("./shared").then(m => console.log(m.greet("b")));',
			'layouts/html.hbs': '{{{ $page.content }}}<bongo:script src="a.ts" format="iife" /><bongo:script src="b.ts" format="iife" />',
			'content/index.html': '<p>home</p>',
		});
		try {
			await build({ cwd: root });
			let html = await read(root, 'index.html');
			let files = [...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map(m => m[1]);
			expect(files).toHaveLength(2);
			for (let file of files) {
				let code = await read(root, file);
				expect(code).toStartWith('(function() {');
				expect(code).toContain('greets');
				expect(code).not.toMatch(/\bimport\b/);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a script has the same bytes whatever folder the build runs from', async () => {
		let root = await site({
			'assets/a.ts': 'console.log(document.title);',
			'layouts/html.hbs': '{{{ $page.content }}}<bongo:script src="a.ts" />',
			'content/index.html': '<p>home</p>',
		});
		let script = `import { build } from ${JSON.stringify(join(import.meta.dirname, 'build.ts'))};\nconsole.log = () => {};\nawait build({ cwd: ${JSON.stringify(root)} });`;
		let code = async (cwd: string) => {
			let child = Bun.spawn([process.execPath, '-e', script], { cwd, stdout: 'ignore', stderr: 'pipe' });
			let [err, exit] = await Promise.all([new Response(child.stderr).text(), child.exited]);
			if (exit !== 0) throw new Error(err);
			let file = /src="\/([^"]+\.js)"/.exec(await read(root, 'index.html'))?.[1];
			if (!file) throw new Error('index.html links no script');
			return read(root, file);
		};
		try {
			expect(await code(tmpdir())).toBe(await code(root));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a stylesheet added after a build that missed it builds', async () => {
		let root = await site({
			'layouts/html.hbs': '{{{ $page.content }}}<bongo:style src="late.css" />',
			'content/index.html': '<p>home</p>',
		});
		try {
			await expect(build({ cwd: root, dev: true })).rejects.toThrow('Missing "assets/late.css"');
			await mkdir(join(root, 'assets'), { recursive: true });
			await writeFile(join(root, 'assets/late.css'), '.a { color: red }');
			await build({ cwd: root, dev: true });
			expect(await read(root, 'index.html')).toMatch(/href="\/late\.[^"]+\.css"/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('an inline style keeps its other attributes', async () => {
		let root = await site({
			'assets/print.css': '.a { color: red }',
			'layouts/html.hbs': '{{{ $page.content }}}<bongo:style src="print.css" media="print" nonce="r4nd" inline />',
			'content/index.html': '<p>home</p>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toMatch(/<style media="print" nonce="r4nd">\.a \{\s*color: red;?\s*\}\s*<\/style>/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('template errors', () => {
	test('name the content file and the layouts that rendered the page', async () => {
		let cases: [Record<string, string>, string][] = [
			[{ 'content/blog/post.hbs': '<p>{{ $utils.nope() }}</p>' }, ', rendering content/blog/post.hbs'],
			[{ 'content/blog/post.html': '<p>post</p>', 'layouts/blog/single.hbs': '{{ $utils.nope() }}' }, ', rendering content/blog/post.html → layouts/blog/single.hbs'],
			[{ 'content/blog/post.html': '<p>post</p>', 'layouts/html.hbs': '{{ $utils.nope() }}' }, ', rendering content/blog/post.html → layouts/html.hbs'],
			[{ 'content/feed.xml.hbs': '{{ $utils.nope() }}' }, ', rendering content/feed.xml.hbs'],
		];
		for (let [files, where] of cases) {
			let root = await site(files);
			try {
				templates.Partials.clear();
				templates.Layouts.clear();
				let err = await build({ cwd: root }).then(() => undefined, (err: Error) => err);
				expect(err?.message).toMatch(/nope/);
				expect(err?.message).toEndWith(where);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});
});

describe('alternates', () => {
	const CONFIG = (url = 'https://example.com/') => [
		`export default {`,
		`	$site: { url: '${url}', title: 'T', lang: 'en' },`,
		`	$loaders: {`,
		`		md(file, content, utils) {`,
		`			let text = typeof content === 'string' ? content : utils.decode(content);`,
		`			let { offset, value } = utils.frontmatter(text);`,
		`			return { filename: file + '.html', content: '<p>' + text.slice(offset).trim() + '</p>', metadata: value };`,
		`		},`,
		`	},`,
		`};`,
	].join('\n');

	test('writes a Markdown copy of each page whose layout has <bongo:alternate type="text/markdown">, from its source', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG('https://example.com/sub/'),
			'layouts/html.hbs': '<bongo:alternate type="text/markdown" />{{{ $page.content }}}',
			'content/index.md': '---\ntitle: Home\nsummary: Welcome.\n---\n\nHi — there.\n',
			'content/about.md': '---\ntitle: About\n---\nText',
			'content/blog/post.md': 'Body\n',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.md')).toBe('# Home\n\n> Welcome.\n\nHi — there.\n');
			expect(await read(root, 'about.md')).toBe('# About\n\nText\n');
			expect(await read(root, 'blog/post.md')).toBe('Body\n');
			expect(await read(root, 'index.html')).toBe('<link rel="alternate" type="text/markdown" href="/sub/index.md"/><p>Hi — there.</p>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('output files and data modules see the alternates of each page, as they render after every page', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG(),
			'layouts/html.hbs': '<bongo:alternate type="text/markdown" />{{{ $page.content }}}',
			'layouts/blog/html.hbs': '<bongo:alternate type="text/markdown" /><bongo:alternate type="application/rss+xml" href="/blog/feed.xml" />{{{ $page.content }}}',
			'content/a.md': 'A',
			'content/blog/b.md': 'B',
			'layouts/misc/html.hbs': '{{{ $page.content }}}',
			'content/misc/plain.html': '<p>plain</p>',
			'content/llms.txt.hbs': `# Pages\n{{#each $pages as p}}\n- {{{ p.path }}} {{{ p.alternates['text/markdown'] ?? '-' }}}{{/each}}\n`,
			'content/list.json.ts': 'export default ({ $pages }) => $pages.map(page => page.alternates);',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'llms.txt')).toBe('# Pages\n- /a/ /a.md\n- /blog/b/ /blog/b.md\n- /misc/plain/ -');
			expect(JSON.parse(await read(root, 'list.json'))).toEqual([
				{ 'text/markdown': '/a.md' },
				{ 'text/markdown': '/blog/b.md', 'application/rss+xml': '/blog/feed.xml' },
				{},
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a page with no Markdown source gets no copy and no <link>, so one layout serves every page', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG(),
			'layouts/html.hbs': '<bongo:alternate type="text/markdown" />{{{ $page.content }}}',
			'content/a.md': 'A',
			'content/index.hbs': '<p>home</p>',
			'content/list.json.ts': 'export default ({ $pages }) => $pages.map(page => [page.path, page.alternates]);',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toBe('<p>home</p>');
			expect(existsSync(join(root, 'public/index.md'))).toBe(false);
			expect(JSON.parse(await read(root, 'list.json'))).toEqual([['/', {}], ['/a/', { 'text/markdown': '/a.md' }]]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('one page may name its copy twice, but two pages may not write one file', async () => {
		let twice = await site({
			'bongo.config.ts': CONFIG(),
			'layouts/html.hbs': '<bongo:alternate type="text/markdown" /><bongo:alternate type="text/markdown" />{{{ $page.content }}}',
			'content/a.md': 'A',
		});
		try {
			await build({ cwd: twice });
			expect(await read(twice, 'a.md')).toBe('A\n');
		} finally {
			await rm(twice, { recursive: true, force: true });
		}

		let cases: [Record<string, string>, string][] = [
			[{ 'content/a.md': 'A', 'content/b.md': 'B', 'layouts/html.hbs': '<bongo:alternate type="text/markdown" href="/same.md" />' }, '"same.md" is a Markdown copy of content/a.md and of content/b.md'],
			[{ 'content/a.md': 'A', 'content/notes.txt': 'mine', 'layouts/html.hbs': '<bongo:alternate type="text/markdown" href="/notes.txt" />' }, '"notes.txt" is a Markdown copy of content/a.md, and a file of the site'],
		];
		for (let [files, message] of cases) {
			let root = await site({ 'bongo.config.ts': CONFIG(), 'layouts/html.hbs': '<bongo:alternate type="text/markdown" />', ...files });
			try {
				let err = await build({ cwd: root }).then(() => undefined, (err: Error) => err);
				expect(err?.message).toContain(message);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
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

	test('file partials get the page values of the page that renders them, and arguments win', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $partials: { keys: args => Object.keys(args).join(',') } };`,
			'partials/where.hbs': '{{ $page.path }}:{{ $pages.length }}:{{ $section.length }}:{{ $tags.length }}{{#partial src="inner"}}',
			'partials/inner.hbs': '[{{ $page.title }}]',
			'partials/mod.ts': 'export default (args: { $page: { path: string } }) => `<${args.$page.path}>`;',
			'partials/named.hbs': '{{ $page.title }}',
			'layouts/html.hbs': '{{#partial src="where"}} {{#partial src="mod"}} {{#partial src="named" $page=({ title: \'given\' })}} {{#partial src="keys" a=1}} {{{ $page.content }}}',
			'content/blog/a.html': '---\ntitle: A\ntags: x\n---\n',
			'content/blog/b.hbs': '---\ntitle: B\n---\n{{#partial src="inner"}}',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'blog/a/index.html')).toBe('/blog/a/:2:2:1[A] </blog/a/> given a \n');
			expect(await read(root, 'blog/b/index.html')).toBe('/blog/b/:2:2:1[B] </blog/b/> given a [B]');
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

			await writeFile(join(root, 'content/index.html'), '---\ntitle: Home\n---\n<bongo:style src="style.css" />');
			await build({ cwd: root });
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

describe('page writes', () => {
	test('bongo build writes each page as it renders, and dev writes none until every page is ready', async () => {
		let root = await site({
			'bongo.config.ts': `import { existsSync } from 'node:fs'; export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $hooks: { transform: (text, ctx) => ctx.path === '/' ? text + '|' + existsSync(import.meta.dirname + '/public/b/index.html') : text } };`,
			'content/index.html': '<p>home</p>',
			'content/b.html': '<p>b</p>',
		});
		try {
			await build({ cwd: root });
			expect(await read(root, 'index.html')).toBe('<html><p>home</p></html>|true');
			await build({ cwd: root, dev: true });
			expect(await read(root, 'index.html')).toEndWith('</script>|false');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a failed bongo build leaves none of the pages it wrote', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $hooks: { transform(text, ctx) { if (ctx.path === '/b/') throw new Error('no thanks'); return text; } } };`,
			'content/index.html': '<p>home</p>',
			'content/b.html': '<p>b</p>',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('no thanks, rendering content/b.html → layouts/html.hbs');
			expect(existsSync(join(root, 'public/index.html'))).toBe(false);
			expect(existsSync(join(root, 'public/b/index.html'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('bongo build writes over the files of the last build, and deletes each one that it no longer writes', async () => {
		let root = await site({
			'content/index.html': '<p>home</p>',
			'content/old.html': '<p>old</p>',
		});
		try {
			await build({ cwd: root });
			let inode = (await stat(join(root, 'public/index.html'))).ino;
			await rm(join(root, 'content/old.html'));
			await writeFile(join(root, 'content/new.html'), '<p>new</p>');
			await build({ cwd: root });
			expect((await stat(join(root, 'public/index.html'))).ino).toBe(inode);
			expect(existsSync(join(root, 'public/old'))).toBe(false);
			expect(await read(root, 'new/index.html')).toBe('<html><p>new</p></html>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('bongo build collects the garbage of rendering once, before it writes the pages again; dev does not', async () => {
		let root = await site({ 'content/index.html': '<p>home</p>' });
		let gc = spyOn(Bun, 'gc');
		try {
			await build({ cwd: root });
			expect(gc.mock.calls).toEqual([[true]]);
			gc.mockClear();
			await build({ cwd: root, dev: true });
			expect(gc).not.toHaveBeenCalled();
		} finally {
			gc.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a dev build keeps none of its pages in memory once it returns', async () => {
		let layout = { 'partials/note.hbs': '<i>note</i>', 'layouts/html.hbs': '<html>{{#partial src="note"}}{{{ $page.content }}}</html>' };
		// one body for every page, so the test itself holds 80 kB, and the build would hold 200 pages
		let body = '<p>' + '—'.repeat(40_000) + '</p>';
		let warm = await site({ ...layout, 'content/index.html': '<p>warm</p>' });
		let root = await site({ ...layout, ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`content/p${i}.html`, body])) });
		// a fresh process, since JSC scans the stack, and a stale frame in a long test run can pin the build; each GC also runs in a new task
		let script = [
			`import { heapStats } from 'bun:jsc';`,
			`import { build } from ${JSON.stringify(join(import.meta.dirname, 'build.ts'))};`,
			`console.log = () => {};`,
			`let live = async () => { await new Promise(next => setTimeout(next)); Bun.gc(true); return heapStats().heapSize; };`,
			`await build({ cwd: ${JSON.stringify(warm)}, dev: true });`,
			`let before = await live();`,
			`await build({ cwd: ${JSON.stringify(root)}, dev: true });`,
			`process.stdout.write('@delta ' + (await live() - before));`,
		].join('\n');
		try {
			let child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
			let [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
			let delta = /@delta (\d+)/.exec(out)?.[1];
			if (delta === undefined) throw new Error(err || out);
			expect(Number(delta)).toBeLessThan(5e6);
		} finally {
			await rm(warm, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a failed bongo build waits for the writes it started, so none lands after it empties public/', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $loaders: { bad: () => { throw new Error('no thanks'); }, slow: async (file, content) => { await new Promise(r => setTimeout(r, 50)); return { filename: file + '.txt', content }; } } };`,
			'content/a.bad': 'a',
			'content/b.slow': 'b',
		});
		try {
			await expect(build({ cwd: root })).rejects.toThrow('content/a.bad: no thanks');
			await new Promise(r => setTimeout(r, 100));
			expect(existsSync(join(root, 'public/b.slow'))).toBe(false);
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

describe('incremental builds', () => {
	let config = (title: string) => [
		`export default {`,
		`	$site: { url: 'https://example.com/', title: ${JSON.stringify(title)}, lang: 'en' },`,
		`	$loaders: {`,
		`		md(file, content, utils) {`,
		`			let text = utils.decode(content);`,
		`			let { offset, value } = utils.frontmatter(text);`,
		`			return { filename: file.replace(/\\.md$/, '.html'), content: '<p>' + text.slice(offset).trim() + '</p>', metadata: value };`,
		`		},`,
		`	},`,
		`	$hooks: {`,
		`		transform(text, ctx) {`,
		`			if (ctx.kind === 'page') (globalThis.__rendered ??= []).push(ctx.path);`,
		`			return text;`,
		`		},`,
		`	},`,
		`};`,
	].join('\n');

	// a site with each input an incremental build must follow: registries, partials, data, loaded assets, bundles, loaders, copies, output files, and data modules
	let sources = (): Record<string, string> => ({
		'bongo.config.ts': config('Site'),
		'data/meta.json': '{ "motto": "hello" }',
		'assets/style.css': 'body { color: red }',
		'assets/main.ts': 'console.log(1);',
		'assets/icon.svg': '<svg id="v1"/>',
		'layouts/html.hbs': '<html><title>{{ $page.title }} · {{ $site.title }}</title><bongo:alternate type="text/markdown" /><bongo:style src="style.css" />{{{ $page.content }}}{{#partial src="foot"}}<bongo:script src="main.ts" /></html>',
		'layouts/blog/single.hbs': '{{#var at = $section.findIndex(p => p.path === $page.path)}}<article>{{{ $page.content }}}<a href="{{ $section[at + 1]?.path }}">next</a></article>',
		'partials/foot.hbs': '<footer>{{ $data.meta.motto }} {{{ await $assets.load("icon.svg", "utf8") }}}</footer>',
		'content/index.hbs': '---\ntitle: Home\n---\n{{#each $pages as p}}<a href="{{ p.path }}">{{ p.title }}</a>{{/each}}',
		'content/tags.hbs': '---\ntitle: Tags\n---\n{{#each $tags as t}}<h2>{{ t.tag }}</h2>{{#each t.pages as p}}{{ p.title }}{{/each}}{{/each}}',
		'content/about.html': '---\ntitle: About\n---\n<p>about</p>',
		'content/blog/a.html': '---\ntitle: A\ntags: x\n---\n<p>a</p>',
		'content/blog/b.html': '---\ntitle: B\ntags: y\n---\n<p>b</p>',
		'content/notes/n.md': '---\ntitle: Note\n---\nplain text',
		'content/files/data.csv': 'a,b',
		'content/sitemap.xml.hbs': '{{#each $pages as p}}<url>{{ p.url }}</url>{{/each}}',
		'content/search.json.ts': 'export default ({ $pages }) => $pages.map(p => p.title);',
	});

	let all = ['/', '/about/', '/blog/a/', '/blog/b/', '/notes/n/', '/tags/'];

	type Step = { name: string; change(root: string): Promise<void>; build: string[]; dev?: string[] };

	let edit = (rel: string, from: string, to: string) => async (root: string) => {
		let file = join(root, rel);
		await writeFile(file, (await readFile(file, 'utf8')).replace(from, to));
	};

	let steps: Step[] = [
		{ name: 'nothing changed', change: async () => {}, build: [] },
		{ name: 'a body', change: edit('content/about.html', '<p>about</p>', '<p>about us</p>'), build: ['/about/'] },
		{ name: 'a title', change: edit('content/blog/a.html', 'title: A\n', 'title: A2\n'), build: ['/', '/blog/a/', '/blog/b/', '/tags/'] },
		{ name: 'a new page', change: root => writeFile(join(root, 'content/blog/c.html'), '---\ntitle: C\ntags: x\n---\n<p>c</p>'), build: ['/', '/blog/a/', '/blog/b/', '/blog/c/', '/tags/'] },
		{ name: 'a deleted page', change: root => rm(join(root, 'content/blog/b.html')), build: ['/', '/blog/a/', '/blog/c/', '/tags/'] },
		{ name: 'a Markdown source', change: edit('content/notes/n.md', 'plain text', 'other text'), build: ['/notes/n/'] },
		{ name: 'a copied file', change: edit('content/files/data.csv', 'a,b', 'a,c'), build: [] },
		{ name: 'a layout', change: edit('layouts/html.hbs', '<html>', '<html lang="en">'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'] },
		{ name: 'a partial', change: edit('partials/foot.hbs', '<footer>', '<footer class="f">'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'] },
		{ name: 'a data file', change: edit('data/meta.json', 'hello', 'hi'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'] },
		{ name: 'a loaded asset', change: edit('assets/icon.svg', 'v1', 'v2'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'] },
		{ name: 'a stylesheet', change: edit('assets/style.css', 'red', 'blue'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'], dev: [] },
		{ name: 'the config', change: edit('bongo.config.ts', '"Site"', '"Site 2"'), build: ['/', '/about/', '/blog/a/', '/blog/c/', '/notes/n/', '/tags/'] },
	];

	async function tree(dir: string): Promise<Map<string, Buffer>> {
		let { readdir } = await import('node:fs/promises');
		let out: Map<string, Buffer> = new Map();
		for (let entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile()) continue;
			let file = join(entry.parentPath, entry.name);
			out.set(file.slice(dir.length + 1), await readFile(file));
		}
		return out;
	}

	// a fresh build of the same sources, in the same folder, since bundle names depend on it, as the reference
	async function same(root: string, dev: boolean): Promise<void> {
		let ours = await tree(join(root, 'public'));
		await build({ cwd: root, dev, fresh: true });
		let fresh = await tree(join(root, 'public'));
		expect([...ours.keys()].sort()).toEqual([...fresh.keys()].sort());
		for (let [file, bytes] of fresh) {
			expect({ file, text: ours.get(file)?.toString() }).toEqual({ file, text: bytes.toString() });
		}
	}

	let rendered = (): string[] => {
		let list = [...new Set((globalThis as { __rendered?: string[] }).__rendered ?? [])].sort();
		(globalThis as { __rendered?: string[] }).__rendered = [];
		return list;
	};

	for (let dev of [false, true]) {
		test(`${dev ? 'dev' : 'bongo build'} renders only the pages that a change reaches, and writes the bytes of a fresh build`, async () => {
			let root = await site(sources());
			try {
				rendered();
				await build({ cwd: root, dev });
				expect(rendered()).toEqual(all);
				for (let step of steps) {
					await step.change(root);
					await build({ cwd: root, dev });
					expect({ step: step.name, rendered: rendered() }).toEqual({ step: step.name, rendered: dev ? step.dev ?? step.build : step.build });
					await same(root, dev);
					rendered();
				}
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}, 60_000);
	}

	test('--fresh renders every page', async () => {
		let root = await site(sources());
		try {
			await build({ cwd: root });
			rendered();
			await build({ cwd: root, fresh: true });
			expect(rendered()).toEqual(all);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
