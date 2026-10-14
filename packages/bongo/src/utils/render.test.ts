import { beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from '../build';
import * as bundler from './bundler';
import * as render from './render';
import * as templates from './templates';

const FONT = join(import.meta.dirname, '../../test/fixtures/fonts/grotesk.woff');
const FACE = `<style>@font-face { font-family: Grotesk; src: url(fonts/grotesk.woff) format('woff'); font-weight: 500 }</style>`;

beforeEach(() => {
	bundler.reset();
	templates.Layouts.clear();
	templates.Partials.clear();
});

async function site(files: Record<string, string>): Promise<string> {
	let root = join(tmpdir(), `bongo-render-${randomBytes(6).toString('hex')}`);
	let all: Record<string, string | Buffer> = {
		'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
		'layouts/html.hbs': '{{{ $page.content }}}',
		'assets/fonts/grotesk.woff': await readFile(FONT),
		...files,
	};
	for (let [rel, data] of Object.entries(all)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), data);
	}
	return root;
}

function size(png: Buffer): [number, number] {
	return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('parse', () => {
	test('turns markup into a Satori tree, with style objects, entities, and void and self-closing tags', () => {
		let { root, fonts } = render.parse([
			'<div style="display: flex; font-size: 40px; -webkit-line-clamp: 2; background-image: url(data:image/svg+xml;utf8,a)" data-x="1">',
			'  <img src="img/a.svg" width="10">',
			'  <span>A &amp; B&#39;s &mdash; &#x2192;</span>',
			'  <br/>',
			'</div>',
		].join('\n'));
		expect(fonts).toEqual([]);
		expect(root).toEqual({
			type: 'div',
			props: {
				style: { display: 'flex', fontSize: '40px', WebkitLineClamp: '2', backgroundImage: 'url(data:image/svg+xml;utf8,a)' },
				'data-x': '1',
				children: [
					{ type: 'img', props: { src: 'img/a.svg', width: '10' } },
					{ type: 'span', props: { children: 'A & B\'s — →' } },
					{ type: 'br', props: {} },
				],
			},
		});
	});

	test('keeps the attributes of inline SVG as written, and an only child as it is', () => {
		let { root } = render.parse('<svg viewBox="0 0 10 10"><path fill-rule="evenodd" d="M0 0h10v10z"/></svg>');
		expect(root).toEqual({
			type: 'svg',
			props: { viewBox: '0 0 10 10', children: { type: 'path', props: { 'fill-rule': 'evenodd', d: 'M0 0h10v10z' } } },
		});
	});

	test('reads the @font-face rules of <style> elements, and drops the elements', () => {
		let { root, fonts } = render.parse([
			'<style>',
			'  /* the brand fonts */',
			'  @font-face { font-family: "Space Grotesk"; src: url(/fonts/sg.woff2) format("woff2"), url(./fonts/sg.woff) format("woff"); font-weight: bold }',
			'  @font-face { font-family: Mono; src: url(fonts/mono.ttf); font-style: italic; font-weight: 300 }',
			'</style>',
			'<p>hi</p>',
		].join('\n'));
		expect(fonts).toEqual([
			{ name: 'Space Grotesk', src: 'fonts/sg.woff', weight: 700, style: 'normal' },
			{ name: 'Mono', src: 'fonts/mono.ttf', weight: 300, style: 'italic' },
		]);
		expect(root).toEqual({ type: 'p', props: { children: 'hi' } });
	});

	test('skips XML declarations and CDATA, ignores a stray void close tag, and leaves unknown entities as written', () => {
		let { root } = render.parse('<?xml version="1.0"?><div><![CDATA[x]]>&constructor; &#99999999; &#65;<br></br></div>');
		expect(root).toEqual({ type: 'div', props: { children: ['&constructor; &#99999999; A', { type: 'br', props: {} }] } });
	});

	test('reads the first family, the first weight of a range, and a src without its query or hash', () => {
		let { fonts } = render.parse([
			'<style>',
			'  @font-face { font-family: "A", sans-serif; src: url(fonts/inter-woff2/My%20Font.ttf?v=2#x); font-weight: 100 900 }',
			'  @font-face { font-family: B; src: url(b.woff2?v=1), url(b.woff) format("woff") }',
			'</style>',
			'<p>hi</p>',
		].join('\n'));
		expect(fonts).toEqual([
			{ name: 'A', src: 'fonts/inter-woff2/My Font.ttf', weight: 100, style: 'normal' },
			{ name: 'B', src: 'b.woff', weight: 400, style: 'normal' },
		]);
	});

	test('fails on markup or styles that Satori cannot draw', () => {
		expect(() => render.parse('<div><p>a</div>')).toThrow('<p> is not closed');
		expect(() => render.parse('<div>a</p></div>')).toThrow('</p> closes no element');
		expect(() => render.parse('<p>a</p><p>b</p>')).toThrow('needs one root element, not 2');
		expect(() => render.parse('')).toThrow('needs one root element, not 0');
		expect(() => render.parse('<style>p { color: red }</style><p>a</p>')).toThrow('<style> may hold only @font-face rules');
		expect(() => render.parse('<style>@font-face { src: url(a.woff) }</style><p>a</p>')).toThrow('@font-face needs a font-family');
		expect(() => render.parse('<style>@font-face { font-family: A }</style><p>a</p>')).toThrow('@font-face "A" needs a src');
		expect(() => render.parse('<style>@font-face { font-family: A; src: url(a.woff2) }</style><p>a</p>')).toThrow('Satori cannot read WOFF2');
		expect(() => render.parse('<style>@font-face { font-family: A; src: url(https://x.dev/a.woff) }</style><p>a</p>')).toThrow('a file in assets/');
		expect(() => render.parse('<style>@font-face { font-family: A; src: url(a.woff); font-weight: bolder }</style><p>a</p>')).toThrow('@font-face "A" font-weight "bolder" is not a number, normal, or bold');
		expect(() => render.parse('<style>@font-face { font-family: A; src: url(a.woff) format("woff2") }</style><p>a</p>')).toThrow('Satori cannot read WOFF2');
	});
});

describe('$assets.render', () => {
	test('renders a partial with the page values to a PNG, and returns its URL path', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/docs/', title: 'T', lang: 'en' } };`,
			'partials/og/card.hbs': FACE + '<div style="display: flex; width: 100%; height: 100%; background: {{ $page.params.color }}; font-family: Grotesk; font-size: 80px">{{ $page.title }}</div>',
			'layouts/html.hbs': `{{#var card = await $assets.render('og/card', 'og/' + $page.params.slug + '.png')}}<meta content="{{ card }}">{{{ $page.content }}}`,
			'content/index.html': '---\ntitle: Home\nslug: home\ncolor: "#ffd23f"\n---\n<p>home</p>',
		});
		try {
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('<meta content="/docs/og/home.png">\n<p>home</p>');
			let png = await readFile(join(root, 'public/og/home.png'));
			expect(png.subarray(1, 4).toString()).toBe('PNG');
			expect(size(png)).toEqual([1200, 630]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('the extension picks the format: .svg, .png, and with Bun, .jpg and .webp', async () => {
		let root = await site({
			'partials/card.hbs': FACE + '<div style="display: flex; width: 100%; height: 100%; background: #ff3366; font-family: Grotesk">hi</div>',
			'content/index.hbs': [
				`{{ await $assets.render('card', 'card.svg') }}`,
				`{{ await $assets.render('card', 'card.jpg') }}`,
				`{{ await $assets.render('card', 'card.jpeg') }}`,
				`{{ await $assets.render('card', 'card.webp') }}`,
			].join(' '),
		});
		try {
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('/card.svg /card.jpg /card.jpeg /card.webp');
			let svg = await readFile(join(root, 'public/card.svg'), 'utf8');
			expect(svg).toStartWith('<svg width="1200" height="630"');
			expect(svg).toContain('fill="#ff3366"');
			expect((await readFile(join(root, 'public/card.jpg'))).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
			expect((await readFile(join(root, 'public/card.jpeg'))).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
			expect((await readFile(join(root, 'public/card.webp'))).toString('latin1', 8, 12)).toBe('WEBP');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('takes a size and arguments, and the partials it calls get the page values too', async () => {
		let root = await site({
			'partials/card.hbs': '{{#expect tone}}<div style="display: flex; width: 100%; height: 100%; background: {{ tone }}">{{#partial src="dot"}}</div>',
			'partials/dot.hbs': '<div style="width: 10px; height: 10px; background: {{ $page.params.color }}"></div>',
			'partials/head.hbs': `{{ await $assets.render('card', 'card.svg', { width: 400, height: 200, args: { tone: '#00ff00' } }) }}`,
			'layouts/html.hbs': '{{#partial src="head"}}',
			'content/index.html': '---\ncolor: "#0000ff"\n---\n',
		});
		try {
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('/card.svg');
			let svg = await readFile(join(root, 'public/card.svg'), 'utf8');
			expect(svg).toStartWith('<svg width="400" height="200"');
			expect(svg).toContain('fill="#00ff00"');
			expect(svg).toContain('fill="#0000ff"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('without an output path, the file gets a name from its template and content, as a PNG', async () => {
		let root = await site({
			'partials/og/card.hbs': '<div style="display: flex; width: 100%; height: 100%; background: {{ $page.params.color }}"></div>',
			'content/index.hbs': `---\ncolor: red\n---\n{{ await $assets.render('og/card') }}`,
			'content/a.hbs': `---\ncolor: red\n---\n{{ await $assets.render('og/card') }}`,
			'content/b.hbs': `---\ncolor: blue\n---\n{{ await $assets.render('og/card') }}`,
		});
		try {
			await build({ cwd: root });
			let home = await readFile(join(root, 'public/index.html'), 'utf8');
			let a = await readFile(join(root, 'public/a/index.html'), 'utf8');
			let b = await readFile(join(root, 'public/b/index.html'), 'utf8');
			expect(home).toMatch(/^\/card\.[a-f0-9]{8}\.png$/);
			expect(a).toBe(home);
			expect(b).not.toBe(home);
			let names = (await readdir(join(root, 'public'))).filter(name => name.endsWith('.png'));
			expect(names.sort()).toEqual([a.slice(1), b.slice(1)].sort());
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('reads the images and fonts of a template from assets/, and inlines the images', async () => {
		let dot = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>';
		let root = await site({
			'assets/img/dot.svg': dot,
			'partials/card.hbs': FACE + '<div style="display: flex; width: 100%; height: 100%; background-image: url(img/dot.svg); font-family: Grotesk"><img src="/img/dot.svg" width="10" height="10">hi</div>',
			'content/index.hbs': `{{ await $assets.render('card', 'card.svg') }}`,
		});
		try {
			await build({ cwd: root });
			let svg = await readFile(join(root, 'public/card.svg'), 'utf8');
			let inlined = 'data:image/svg+xml;base64,' + Buffer.from(dot).toString('base64');
			expect(svg.split(inlined).length - 1).toBe(2);
			expect(svg).toContain('<path');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('keeps a url() that is not a file in assets/ as written', async () => {
		let image = 'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;10&quot; height=&quot;10&quot;><rect width=&quot;10&quot; height=&quot;10&quot; fill=&quot;rgb(171, 205, 239)&quot;/></svg>';
		let root = await site({
			'partials/card.hbs': `<div style="display: flex; width: 100%; height: 100%; background-image: url('${image}')"></div>`,
			'content/index.hbs': `{{ await $assets.render('card', 'card.svg') }}`,
		});
		try {
			await build({ cwd: root });
			let svg = await readFile(join(root, 'public/card.svg'), 'utf8');
			let drawn = /<pattern[^>]*><image[^>]*href="data:image\/svg\+xml;base64,([^"]+)"/.exec(svg)?.[1] ?? '';
			expect(Buffer.from(drawn, 'base64').toString()).toContain('fill="rgb(171, 205, 239)"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a narrow rebuild fails when a page renders over the image of a page it did not render again', async () => {
		let root = await site({
			'partials/card.hbs': '<div style="display: flex; width: 100%; height: 100%; background: {{ $page.params.color }}"></div>',
			'content/a.hbs': `---\ncolor: red\n---\n{{ await $assets.render('card', 'a.png') }}`,
			'content/b.hbs': `---\ncolor: blue\n---\n{{ await $assets.render('card', 'b.png') }}`,
		});
		try {
			await build({ cwd: root });
			await writeFile(join(root, 'content/b.hbs'), `---\ncolor: blue\n---\n{{ await $assets.render('card', 'a.png') }}`);
			let err = await build({ cwd: root }, { only: 'b.hbs' }).then(() => undefined, (err: Error) => err);
			expect(err?.message).toContain('"a.png" renders twice with different content, from /a/ and /b/');

			await writeFile(join(root, 'content/b.hbs'), `---\ncolor: blue\n---\n{{ await $assets.render('card', 'c.png') }}`);
			await build({ cwd: root }, { only: 'b.hbs' });
			expect((await readdir(join(root, 'public'))).filter(name => name.endsWith('.png')).sort()).toEqual(['a.png', 'c.png']);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('keeps each render in the cache, so the next build reads it from there', async () => {
		let root = await site({
			'partials/card.hbs': '<div style="display: flex; width: 100%; height: 100%; background: red"></div>',
			'content/index.hbs': `{{ await $assets.render('card', 'card.png') }}`,
		});
		try {
			await build({ cwd: root });
			let cache = join(root, 'node_modules/.cache/bongo/render');
			let [entry] = await readdir(cache);
			expect(entry).toMatch(/^[a-f0-9]{16}\.png$/);
			await writeFile(join(cache, entry), 'cached');
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/card.png'), 'utf8')).toBe('cached');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('fails the build with the reason and the page', async () => {
		let cases: [Record<string, string>, string][] = [
			[{ 'partials/card.hbs': '<p>hi</p>' }, 'Cannot render "card.png" from partials/card.hbs: it has text, but declares no fonts; add an @font-face rule in a <style> element'],
			[{ 'partials/card.hbs': '<style>@font-face { font-family: A; src: url(fonts/none.woff) }</style><p>hi</p>' }, 'Missing "fonts/none.woff" asset'],
			[{ 'partials/card.hbs': '<style>@font-face { font-family: A; src: url(fonts/fake.woff) }</style><p>hi</p>', 'assets/fonts/fake.woff': 'wOF2xxxx' }, '"fonts/fake.woff" is WOFF2, which Satori cannot read'],
			[{ 'partials/card.hbs': '<div><img src="img/none.png"></div>' }, 'Missing "img/none.png" asset'],
			[{ 'partials/card.hbs': '<div><img src=""></div>' }, 'Cannot render "card.png" from partials/card.hbs: an empty src names no file'],
			[{ 'partials/card.hbs': '<p>a</p><p>b</p>' }, 'Cannot render "card.png" from partials/card.hbs: it needs one root element, not 2'],
			[{ 'partials/card.hbs': '<div></div>', 'content/index.hbs': `{{ await $assets.render('card', 'card.gif') }}` }, 'Cannot render "card.gif": use .svg, .png, .jpg, or .webp'],
			[{ 'partials/card.hbs': '<div></div>', 'content/index.hbs': `{{ await $assets.render('card', '../card.png') }}` }, 'Cannot render "../card.png": the path leaves the site'],
			[{ 'partials/card.hbs': '<div></div>', 'content/index.hbs': `{{ await $assets.render('card', 'card.png', { width: 0 }) }}` }, 'Invalid width "0"'],
			[{ 'content/index.hbs': `{{ await $assets.render('nope', 'card.png') }}` }, 'Unknown "nope" partial!'],
			[{
				'partials/card.hbs': '<div style="background: {{ $page.params.color }}"></div>',
				'content/index.hbs': `---\ncolor: red\n---\n{{ await $assets.render('card', 'card.png') }}`,
				'content/about.hbs': `---\ncolor: blue\n---\n{{ await $assets.render('card', 'card.png') }}`,
			}, '"card.png" renders twice with different content, from /about/ and /'],
		];
		for (let [files, message] of cases) {
			let root = await site({ 'content/index.hbs': `{{ await $assets.render('card', 'card.png') }}`, ...files });
			try {
				templates.Partials.clear();
				let err = await build({ cwd: root }).then(() => undefined, (err: Error) => err);
				expect(err?.message).toContain(message);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});

	test('a render may not write over a file of the site', async () => {
		let root = await site({
			'partials/card.hbs': '<div></div>',
			'content/card.png': 'mine',
			'content/index.hbs': `{{ await $assets.render('card', 'card.png') }}`,
		});
		try {
			let err = await build({ cwd: root }).then(() => undefined, (err: Error) => err);
			expect(err?.message).toContain('"card.png" is a file of the site; render to another path');
			expect(existsSync(join(root, 'public/index.html'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
