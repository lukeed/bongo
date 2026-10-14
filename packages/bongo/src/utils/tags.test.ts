import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { parseAttrs, scanBongoTags, scanImages, rewriteTransitionAttrs } from './tags';
import * as bundler from './bundler';

import type { Argv, Config, Images } from 'bongo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tmpAssets(files: Record<string, string>): Promise<string> {
	let dir = join(tmpdir(), `bongo-tags-test-${randomBytes(6).toString('hex')}`);
	await mkdir(join(dir, 'assets'), { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let p = join(dir, 'assets', name);
			await mkdir(join(p, '..'), { recursive: true });
			await writeFile(p, contents);
		}),
	);
	return dir;
}

function makeArgv(dir: string): Required<Argv> {
	return {
		cwd: dir,
		src: dir,
		dest: join(dir, 'public'),
		assets: join(dir, 'assets'),
		content: join(dir, 'content'),
		partials: join(dir, 'partials'),
		layouts: join(dir, 'layouts'),
		debug: false,
		dev: false,
		minify: false,
		port: 3000,
		host: 'localhost',
	} as Required<Argv>;
}

function makeConfig(): Required<Config> {
	return {
		$site: { url: 'https://example.com', lang: '', title: '', description: '', menu: {} },
		$utils: {
			truncate: (t: string, l: number) => t.substring(0, l),
			countwords: (t: string) => t.split(/\s+/g).length,
			url: { abs: (to: string) => to },
			date: { format: (v: string | number | Date) => String(v) },
		},
		$loaders: {},
		$partials: {},
		$build: {},
		$images: {},
		$hooks: {},
		plugins: [],
	} as Required<Config>;
}

beforeEach(() => {
	bundler.reset();
});

// ---------------------------------------------------------------------------
// parseAttrs unit tests
// ---------------------------------------------------------------------------

describe('parseAttrs', () => {
	test('parses double-quoted attribute', () => {
		let parsed = parseAttrs('src="app.css"');
		expect(parsed.src).toBe('app.css');
	});

	test('parses single-quoted attribute', () => {
		let parsed = parseAttrs("src='app.css'");
		expect(parsed.src).toBe('app.css');
	});

	test('parses bareword attribute', () => {
		let parsed = parseAttrs('src=app.css');
		expect(parsed.src).toBe('app.css');
	});

	test('boolean attribute (present, no value) becomes true', () => {
		let parsed = parseAttrs('inline');
		expect(parsed.inline).toBe(true);
	});

	test('parses multiple attributes', () => {
		let parsed = parseAttrs('src="main.ts" async inline');
		expect(parsed.src).toBe('main.ts');
		expect(parsed.async).toBe(true);
		expect(parsed.inline).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// scanBongoTags scanner tests
// ---------------------------------------------------------------------------

describe('scanBongoTags', () => {
	test('<bongo:style src> self-closing emits external <link>', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css" />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<link rel="stylesheet" href="__BONGO_BUNDLE:[a-f0-9]{16}__"\/>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:style src> paired form also emits external <link>', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css"></bongo:style>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<link rel="stylesheet" href="__BONGO_BUNDLE:[a-f0-9]{16}__"\/>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:style src inline> emits inline <style> marker', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}' });
		try {
			let html = '<bongo:style src="a.css" inline></bongo:style>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<style data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/style>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src> emits external <script type=module>', async () => {
		let dir = await tmpAssets({ 'main.ts': 'export {}' });
		try {
			let html = '<bongo:script src="main.ts"></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<script type="module" src="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src inline> emits inline <script> marker', async () => {
		let dir = await tmpAssets({ 'boot.ts': 'export {}' });
		try {
			let html = '<bongo:script src="boot.ts" inline></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(/^<script data-bongo-inline="__BONGO_BUNDLE:[a-f0-9]{16}__"><\/script>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:script src async> includes async attr', async () => {
		let dir = await tmpAssets({ 'a.ts': 'export {}' });
		try {
			let html = '<bongo:script src="a.ts" async></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('async');
			expect(result).toContain('type="module"');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('multiple tags in one HTML string all get scanned', async () => {
		let dir = await tmpAssets({ 'a.css': '.a {}', 'b.ts': 'export {}' });
		try {
			let html = '<bongo:style src="a.css"></bongo:style>\n<bongo:script src="b.ts"></bongo:script>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('<link rel="stylesheet"');
			expect(result).toContain('<script type="module"');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('missing src throws', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:style></bongo:style>';
			expect(() => scanBongoTags(html, makeArgv(dir), makeConfig())).toThrow(/src/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('unknown tag <bongo:something> is left untouched', async () => {
		let dir = await tmpAssets({});
		try {
			// The scanner only matches `script`, `style`, and `client` — other tag names pass through.
			let html = '<bongo:something src="x"></bongo:something>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toBe(html);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client /> emits an ESM script that imports and calls client({})', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toMatch(
				/^<script type="module">import { client } from "__BONGO_BUNDLE:[a-f0-9]{16}__"; client\({}\);<\/script>$/,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> boolean attrs become true in the options object', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client transitions />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('client({ transitions: true });');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> emits no element that would end <head> early', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<head><bongo:client /><meta name="x"/></head>';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).not.toContain('<div');
			expect(result).toMatch(/^<head><script type="module">[^<]*<\/script><meta name="x"\/><\/head>$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> typed attrs keep their types', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client transitions=false prefetch=hover delay=50 />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('client({ transitions: false, prefetch: "hover", delay: 50 });');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> string attrs become quoted values', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client transitions="slide" />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			expect(result).toContain('client({ transitions: "slide" });');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('<bongo:client> repeated on the same page bundles the runtime once', async () => {
		let dir = await tmpAssets({});
		try {
			let html = '<bongo:client /><bongo:client transitions />';
			let result = scanBongoTags(html, makeArgv(dir), makeConfig());
			let matches = result.match(/__BONGO_BUNDLE:[a-f0-9]{16}__/g) ?? [];
			// Both tags reference the same placeholder — bundler.register is idempotent
			// per (entry, cfg) pair, so repeated scans produce one registration.
			expect(matches.length).toBe(2);
			expect(matches[0]).toBe(matches[1]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// rewriteTransitionAttrs tests
// ---------------------------------------------------------------------------

describe('scanBongoTags — <bongo:asset>', () => {
	const TOKEN = /__BONGO_BUNDLE:[a-f0-9]{16}__/;

	async function scan(html: string, files: Record<string, string> = {}, from?: string): Promise<string> {
		let dir = await tmpAssets(files);
		try {
			return scanBongoTags(html, makeArgv(dir), makeConfig(), from);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}

	test('without preload, becomes the bare url token, even inside an attribute', async () => {
		let out = await scan(`<img src="<bongo:asset src='img/a.png'/>" alt="">`, { 'img/a.png': 'x' });
		expect(out).toMatch(/^<img src="__BONGO_BUNDLE:[a-f0-9]{16}__" alt="">$/);
	});

	test('the same file always maps to the same token', async () => {
		let out = await scan(`<bongo:asset src="img/a.png" /> <bongo:asset preload src=img/a.png />`, { 'img/a.png': 'x' });
		let tokens = out.match(new RegExp(TOKEN.source, 'g'))!;
		expect(tokens).toHaveLength(2);
		expect(tokens[0]).toBe(tokens[1]);
	});

	test('preload infers as, type, and crossorigin from the extension', async () => {
		let files = { 'f.woff2': 'x', 'a.png': 'x', 'a.svg': 'x', 'a.css': 'x', 'a.js': 'x', 'a.json': 'x', 'a.bin': 'x' };
		let out = await scan([
			'<bongo:asset preload src="f.woff2" />',
			'<bongo:asset preload src="a.png" />',
			'<bongo:asset preload src="a.svg" />',
			'<bongo:asset preload src="a.css" />',
			'<bongo:asset preload src="a.js" />',
			'<bongo:asset preload src="a.json" />',
			'<bongo:asset preload src="a.bin" />',
		].join('\n'), files);
		let lines = out.replace(new RegExp(TOKEN.source, 'g'), 'URL').split('\n');
		expect(lines).toEqual([
			'<link rel="preload" href="URL" as="font" type="font/woff2" crossorigin/>',
			'<link rel="preload" href="URL" as="image" type="image/png"/>',
			'<link rel="preload" href="URL" as="image" type="image/svg+xml"/>',
			'<link rel="preload" href="URL" as="style" type="text/css"/>',
			'<link rel="preload" href="URL" as="script" type="text/javascript"/>',
			'<link rel="preload" href="URL" as="fetch" type="application/json" crossorigin/>',
			'<link rel="preload" href="URL" as="fetch" crossorigin/>',
		]);
	});

	test('explicit attributes override the inferred ones', async () => {
		let out = await scan(
			'<bongo:asset preload src="a.bin" as="image" type="image/x-icon" crossorigin="use-credentials" media="(width >= 600px)" fetchpriority="high" />',
			{ 'a.bin': 'x' },
		);
		expect(out.replace(TOKEN, 'URL')).toBe('<link rel="preload" href="URL" as="image" type="image/x-icon" crossorigin="use-credentials" media="(width >= 600px)" fetchpriority="high"/>');
	});

	test('type and crossorigin can be turned off, and crossorigin follows an overridden as', async () => {
		let out = await scan(
			'<bongo:asset preload src="f.woff2" type=false crossorigin=false />\n<bongo:asset preload src="a.dat" as="font" />',
			{ 'f.woff2': 'x', 'a.dat': 'x' },
		);
		expect(out.replace(new RegExp(TOKEN.source, 'g'), 'URL').split('\n')).toEqual([
			'<link rel="preload" href="URL" as="font"/>',
			'<link rel="preload" href="URL" as="font" crossorigin/>',
		]);
	});

	test('escapes attribute values', async () => {
		let out = await scan(`<bongo:asset preload src="a.png" media='a"b&c' />`, { 'a.png': 'x' });
		expect(out).toContain(' media="a&quot;b&amp;c"');
	});

	test('a missing file names the asset, the tag, and where it was rendered', async () => {
		let run = () => scan('<p><bongo:asset preload src="fonts/gone.woff2" /></p>', {}, 'content/index.html → layouts/html.hbs');
		await expect(run()).rejects.toThrow('Missing "assets/fonts/gone.woff2"');
		await expect(run()).rejects.toThrow('<bongo:asset preload src="fonts/gone.woff2" />');
		await expect(run()).rejects.toThrow('content/index.html → layouts/html.hbs');
	});

	test('missing src throws', async () => {
		await expect(scan('<bongo:asset preload />')).rejects.toThrow(/<bongo:asset> missing required "src"/);
	});
});

describe('scanBongoTags — <bongo:image>', () => {
	const TOKEN = /__BONGO_BUNDLE:[a-f0-9]{16}__/g;

	type Options = { from?: string; path?: string; images?: Images.Options };

	async function scan(html: string, files: string[] = [], opts: Options = {}): Promise<string> {
		let dir = join(tmpdir(), `bongo-tags-image-${randomBytes(6).toString('hex')}`);
		await Promise.all(files.map(async rel => {
			await mkdir(dirname(join(dir, rel)), { recursive: true });
			await writeFile(join(dir, rel), 'x');
		}));
		try {
			let config = { ...makeConfig(), $images: opts.images ?? {} };
			return scanBongoTags(html, makeArgv(dir), config, opts.from, opts.path).replace(TOKEN, 'TOKEN');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}

	test('becomes a <picture> around a stand-in <img>, lazy and async with auto sizes', async () => {
		let out = await scan('<bongo:image src="img/a.jpg" alt="A" class="hero" />', ['assets/img/a.jpg']);
		expect(out).toBe('<picture><img data-bongo-image="TOKEN" sizes="auto, 100vw" alt="A" class="hero" loading="lazy" decoding="async"/></picture>');
	});

	test('typed attributes become html text: lists join, true is bare, and false or null drops it', async () => {
		let out = await scan('<bongo:image src="img/a.jpg" alt="" width=640 class=[hero, wide] data-zoom=true hidden=false title=null widths=[320, 640] quality=60 />', ['assets/img/a.jpg']);
		expect(out).toBe('<picture><img data-bongo-image="TOKEN" sizes="auto, 100vw" alt="" width="640" class="hero wide" data-zoom loading="lazy" decoding="async"/></picture>');
	});

	test('explicit attributes win, and fetchpriority=high loads eagerly without auto sizes', async () => {
		let out = await scan([
			'<bongo:image src="a.jpg" sizes="50vw" loading="eager" decoding="sync" widths="320" formats="webp" quality="60" />',
			'<bongo:image src="a.jpg" fetchpriority="high" />',
			`<bongo:image src='a.jpg' alt='say "hi"' hidden></bongo:image>`,
		].join('\n'), ['assets/a.jpg'], { images: { sizes: 'auto, (min-width: 800px) 720px, 100vw' } });
		expect(out.split('\n')).toEqual([
			'<picture><img data-bongo-image="TOKEN" sizes="50vw" loading="eager" decoding="sync"/></picture>',
			'<picture><img data-bongo-image="TOKEN" sizes="(min-width: 800px) 720px, 100vw" fetchpriority="high" loading="eager" decoding="async"/></picture>',
			'<picture><img data-bongo-image="TOKEN" sizes="auto, (min-width: 800px) 720px, 100vw" alt="say &quot;hi&quot;" hidden loading="lazy" decoding="async"/></picture>',
		]);
	});

	test('the same file and settings share a token', async () => {
		let dir = await tmpAssets({ 'a.jpg': 'x' });
		try {
			let tokens = (html: string) => scanBongoTags(html, makeArgv(dir), makeConfig()).match(TOKEN)!;
			let [a, b, c] = tokens('<bongo:image src="a.jpg" alt="1" /><bongo:image src="a.jpg" sizes="9vw" /><bongo:image src="a.jpg" widths="9" />');
			expect(a).toBe(b);
			expect(c).not.toBe(a);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('./, ../, and / resolve against the page url, in content/', async () => {
		let files = ['content/blog/post/a.jpg', 'content/blog/b.jpg', 'content/c d.jpg'];
		let out = await scan('<bongo:image src="./a.jpg" /><bongo:image src="../b.jpg" /><bongo:image src="/c%20d.jpg?v=1" />', files, { path: '/blog/post/' });
		expect(out.match(/data-bongo-image/g)).toHaveLength(3);
	});

	test('a missing file names the resolved path, the tag, and where it was rendered', async () => {
		let from = 'content/blog/post.md → layouts/html.hbs';
		let fail = (src: string) => scan(`<bongo:image src="${src}" alt="" />`, [], { from, path: '/blog/post/' });
		await expect(fail('img/gone.jpg')).rejects.toThrow(`Missing "assets/img/gone.jpg" for <bongo:image src="img/gone.jpg" alt="" />, rendering ${from}`);
		await expect(fail('./gone.jpg')).rejects.toThrow('Missing "content/blog/post/gone.jpg"');
		await expect(fail('../../../gone.jpg')).rejects.toThrow('Missing "content/gone.jpg"');
		await expect(fail('/x/gone.jpg')).rejects.toThrow('Missing "content/x/gone.jpg"');
	});

	test('a path that leaves assets/ or content/ fails', async () => {
		let fail = (src: string) => scan(`<bongo:image src="${src}" />`, ['assets/a.jpg', 'secret.jpg'], { path: '/blog/post/' });
		await expect(fail('./a%2f..%2f..%2f..%2f..%2fsecret.jpg')).rejects.toThrow('Image "./a%2f..%2f..%2f..%2f..%2fsecret.jpg" is outside content/ for <bongo:image');
		await expect(fail('img/../../secret.jpg')).rejects.toThrow('Image "img/../../secret.jpg" is outside assets/ for <bongo:image');
	});

	test('decodes html entities in src', async () => {
		let out = await scan('<bongo:image src="./a&amp;b.jpg" /><bongo:image src=" ./a&#38;b.jpg " />', ['content/blog/post/a&b.jpg'], { path: '/blog/post/' });
		expect(out.match(/data-bongo-image/g)).toHaveLength(2);
	});

	test('bad settings name the tag and where it was rendered', async () => {
		let run = scan('<bongo:image src="a.jpg" formats="gif" />', ['assets/a.jpg'], { from: 'content/index.html' });
		await expect(run).rejects.toThrow('Unknown image format "gif"; use avif, webp, jpeg, png, or original for <bongo:image src="a.jpg" formats="gif" />, rendering content/index.html');
	});

	test('missing src throws', async () => {
		await expect(scan('<bongo:image alt="" />')).rejects.toThrow(/<bongo:image> missing required "src"/);
	});
});

describe('scanImages', () => {
	const TOKEN = /__BONGO_BUNDLE:[a-f0-9]{16}__/g;
	const FROM = 'content/blog/post.md';

	async function scan(html: string, files: string[] = [], images: Images.Options = {}): Promise<string> {
		let dir = join(tmpdir(), `bongo-tags-content-${randomBytes(6).toString('hex')}`);
		await Promise.all(files.map(async rel => {
			await mkdir(dirname(join(dir, rel)), { recursive: true });
			await writeFile(join(dir, rel), 'x');
		}));
		try {
			let config = { ...makeConfig(), $images: images };
			return scanImages(html, makeArgv(dir), config, FROM, '/blog/post/').replace(TOKEN, 'TOKEN');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}

	test('turns an <img> with a relative src into a stand-in, in place', async () => {
		let files = ['content/blog/post/a.png', 'content/blog/b.jpg', 'content/blog/post/c d.svg'];
		let out = await scan('<p><img src="a.png" alt="A &amp; B"></p>\n<img src="../b.jpg" class=x loading="eager"/>\n<img alt="" src=\'./c%20d.svg\' width="10" />', files);
		expect(out.split('\n')).toEqual([
			'<p><img data-bongo-image="TOKEN" sizes="auto, 100vw" alt="A &amp; B" loading="lazy" decoding="async"/></p>',
			'<img data-bongo-image="TOKEN" sizes="100vw" class="x" loading="eager" decoding="async"/>',
			'<img data-bongo-image="TOKEN" sizes="auto, 100vw" alt="" width="10" loading="lazy" decoding="async"/>',
		]);
	});

	test('registers the same file and settings as <bongo:image> in the first, preferred format', async () => {
		let dir = await tmpAssets({});
		try {
			await mkdir(join(dir, 'content/blog/post'), { recursive: true });
			await writeFile(join(dir, 'content/blog/post/a.png'), 'x');
			let config = { ...makeConfig(), $images: { formats: ['webp', 'jpeg'] } } as Required<Config>;
			let token = (html: string) => html.match(TOKEN)![0];
			let img = token(scanImages('<img src="a.png">', makeArgv(dir), config, FROM, '/blog/post/'));
			let element = token(scanBongoTags('<bongo:image src="./a.png" formats="webp" />', makeArgv(dir), config, FROM, '/blog/post/'));
			expect(img).toBe(element);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('leaves other images as written', async () => {
		let html = [
			'<img src="https://cdn.example.com/a.png" alt="">',
			'<img src="//cdn.example.com/a.png">',
			'<img src="/blog/post/a.png">',
			'<img src="data:image/png;base64,AAAA">',
			'<img src="#x">',
			'<img src="a.png" srcset="a.png 1x">',
			'<img src="page.html">',
			'<img alt="no src">',
			`<img src="<bongo:asset src='a.png' />">`,
			'<picture><source srcset="a.avif"><img src="a.png"></picture>',
			'<!-- <img src="a.png"> -->',
			'<script>let html = \'<img src="a.png">\';</script>',
			'<image href="a.png"/>',
			'<img-zoom src="a.png"></img-zoom>',
		].join('\n');
		expect(await scan(html)).toBe(html);
	});

	test('decodes html entities in src, as Markdown writes them', async () => {
		let out = await scan('<img src="a&amp;b.png" alt="">', ['content/blog/post/a&b.png']);
		expect(out).toBe('<img data-bongo-image="TOKEN" sizes="auto, 100vw" alt="" loading="lazy" decoding="async"/>');
	});

	test('a path that leaves content/ fails', async () => {
		await expect(scan('<img src="..%2f..%2f..%2f..%2fx.png">')).rejects.toThrow(`Image "..%2f..%2f..%2f..%2fx.png" is outside content/ for <img src="..%2f..%2f..%2f..%2fx.png">, rendering ${FROM}`);
	});

	test('does nothing when $images.content is false', async () => {
		let html = '<img src="gone.png" alt="">';
		expect(await scan(html, [], { content: false })).toBe(html);
	});

	test('a missing file names the resolved path, the tag, and the content file', async () => {
		await expect(scan('<img src="gone.png" alt="">')).rejects.toThrow(`Missing "content/blog/post/gone.png" for <img src="gone.png" alt="">, rendering ${FROM}`);
	});

	test('bad $images settings name the tag and the content file', async () => {
		await expect(scan('<img src="a.png">', ['content/blog/post/a.png'], { widths: [0] })).rejects.toThrow(`Invalid widths "0" for <img src="a.png">, rendering ${FROM}`);
	});
});

describe('rewriteTransitionAttrs', () => {
	test('transition:name adds view-transition-name to style', () => {
		let html = '<aside transition:name="sidebar">content</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('style="view-transition-name: sidebar"');
		expect(result).not.toContain('transition:name');
	});

	test('transition:name merges into existing style attr', () => {
		let html = '<aside style="color:red" transition:name="sidebar">x</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: sidebar');
		expect(result).toContain('color:red');
		expect(result).not.toContain('transition:name');
	});

	test('transition:animate injects ::view-transition-* rule into <style data-bongo-transitions>', () => {
		let html = '<head></head><body><nav transition:name="nav" transition:animate="slide">x</nav></body>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('data-bongo-transitions');
		expect(result).toContain('::view-transition-old(nav)');
		expect(result).toContain('::view-transition-new(nav)');
		expect(result).toContain('animation-name:slide');
		expect(result).not.toContain('transition:animate');
	});

	test('transition:animate without transition:name uses auto-generated name', () => {
		let html = '<head></head><body><section transition:animate="shake">x</section></body>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toMatch(/view-transition-name: bongo-auto-[0-9a-f]+/);
		expect(result).toMatch(/::view-transition-old\(bongo-auto-[0-9a-f]+\)/);
	});

	test('no transition attrs — html unchanged', () => {
		let html = '<aside class="foo">content</aside>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toBe(html);
	});

	test('self-closing element with transition:name is handled correctly', () => {
		let html = '<img transition:name="hero" src="a.png" />';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: hero');
		expect(result).not.toContain('transition:name');
	});

	test('<style data-bongo-transitions> is injected before </head>', () => {
		let html = '<html><head><title>T</title></head><body><span transition:name="x" transition:animate="fade">y</span></body></html>';
		let result = rewriteTransitionAttrs(html);
		let headClose = result.indexOf('</head>');
		let styleIdx = result.indexOf('<style data-bongo-transitions>');
		expect(styleIdx).toBeGreaterThan(-1);
		expect(styleIdx).toBeLessThan(headClose);
	});

	test('multiple elements each get their own rule', () => {
		let html = '<head></head><p transition:name="a" transition:animate="k1">1</p><p transition:name="b" transition:animate="k2">2</p>';
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('::view-transition-old(a)');
		expect(result).toContain('::view-transition-old(b)');
		expect(result).toContain('animation-name:k1');
		expect(result).toContain('animation-name:k2');
	});

	test('single-quoted transition:name is also handled', () => {
		let html = "<aside transition:name='hero'>x</aside>";
		let result = rewriteTransitionAttrs(html);
		expect(result).toContain('view-transition-name: hero');
		expect(result).not.toContain('transition:name');
	});
});
