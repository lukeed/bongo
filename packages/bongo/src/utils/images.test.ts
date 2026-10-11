import { describe, expect, test } from 'bun:test';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import sharp from 'sharp';

import * as images from './images';

const FIXTURE = join(import.meta.dirname, '../../test/fixtures/site-image');
const PHOTO = join(FIXTURE, 'content/blog/post/photo.png');
const PORTRAIT = join(FIXTURE, 'content/blog/post/portrait.jpg');
const DIAGRAM = join(FIXTURE, 'content/blog/post/diagram.svg');
const LOGO = join(FIXTURE, 'assets/img/logo.svg');
const SPIN = join(FIXTURE, 'assets/img/spin.gif');

async function setup(dev = false) {
	let root = await mkdtemp(join(tmpdir(), 'bongo-images-'));
	let outDir = join(root, 'public');
	let cache = join(root, 'cache');
	let emit = async (file: string) => {
		let name = basename(file).replace(/(\.\w+)$/, '.0123abcd$1');
		await Bun.write(join(outDir, name), Bun.file(file));
		return name;
	};
	let ctx = images.context({ outDir, cache, dev, emit });
	return { root, outDir, cache, ctx, done: () => rm(root, { recursive: true, force: true }) };
}

describe('settings', () => {
	test('uses the defaults', () => {
		expect(images.settings({}, {})).toEqual({
			widths: [640, 1280, 1920],
			formats: ['avif', 'webp'],
			quality: { avif: 50, webp: 80 },
		});
	});

	test('config overrides the defaults', () => {
		let out = images.settings({}, { widths: [300, 100, 300], formats: ['webp', 'jpeg'], quality: { jpeg: 70 } });
		expect(out).toEqual({ widths: [100, 300], formats: ['webp', 'jpeg'], quality: { webp: 80, jpeg: 70 } });
	});

	test('a number quality applies to every format, and png has none by default', () => {
		expect(images.settings({}, { formats: ['avif', 'png'], quality: 60 }).quality).toEqual({ avif: 60, png: 60 });
		expect(images.settings({}, { formats: ['png'] }).quality).toEqual({});
	});

	test('attributes override the config', () => {
		let out = images.settings({ widths: '320, 640', formats: 'webp', quality: '60' }, { widths: [1], formats: ['avif'] });
		expect(out).toEqual({ widths: [320, 640], formats: ['webp'], quality: { webp: 60 } });
	});

	test('rejects bad values', () => {
		expect(() => images.settings({ widths: '0' }, {})).toThrow('Invalid widths "0"');
		expect(() => images.settings({ widths: 'big' }, {})).toThrow('Invalid widths "big"');
		expect(() => images.settings({ widths: true }, {})).toThrow('Invalid widths');
		expect(() => images.settings({}, { widths: [] })).toThrow('Invalid widths');
		expect(() => images.settings({ formats: 'jpg' }, {})).toThrow('Unknown image format "jpg"; use avif, webp, jpeg, or png');
		expect(() => images.settings({ quality: '101' }, {})).toThrow('Invalid quality "101"');
		expect(() => images.settings({}, { quality: { webp: 0 } })).toThrow('Invalid quality "0"');
	});
});

describe('prepare', () => {
	test('encodes each width and format, never above the source width', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			let info = await images.prepare(PHOTO, images.settings({}, {}), ctx);
			expect(info.width).toBe(800);
			expect(info.height).toBe(600);
			expect(info.variants.map(v => [v.format, v.width])).toEqual([['avif', 640], ['avif', 800], ['webp', 640], ['webp', 800]]);
			expect(info.filename).toBe(info.variants[3].filename);

			for (let v of info.variants) {
				expect(v.filename).toMatch(new RegExp(`^photo-${v.width}\\.[a-f0-9]{8}\\.${v.format}$`));
				let meta = await sharp(join(outDir, v.filename)).metadata();
				expect([meta.format, meta.width, meta.height]).toEqual([v.format === 'avif' ? 'heif' : v.format, v.width, v.width * 3 / 4]);
			}
		} finally {
			await done();
		}
	});

	test('keeps a source narrower than every width at its own width, upright', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			let info = await images.prepare(PORTRAIT, images.settings({ formats: 'jpeg' }, {}), ctx);
			expect([info.width, info.height]).toEqual([400, 600]);
			expect(info.variants).toEqual([{ format: 'jpeg', width: 400, filename: expect.stringMatching(/^portrait-400\.[a-f0-9]{8}\.jpg$/) }]);
			let meta = await sharp(join(outDir, info.filename)).metadata();
			expect([meta.width, meta.height, meta.orientation]).toEqual([400, 600, undefined]);
		} finally {
			await done();
		}
	});

	test('reuses cached files across builds', async () => {
		let first = await setup();
		try {
			let opts = images.settings({ formats: 'webp' }, {});
			let info = await images.prepare(PHOTO, opts, first.ctx);
			let cached = await readdir(first.cache);
			expect(cached).toHaveLength(2);

			let name = info.variants[0].filename;
			let hit = cached.find(f => f.startsWith(name.split('.')[1]))!;
			await writeFile(join(first.cache, hit), 'cached');

			let outDir = join(first.root, 'again');
			let again = images.context({ ...first.ctx, outDir });
			let next = await images.prepare(PHOTO, opts, again);
			expect(next.variants).toEqual(info.variants);
			expect(await readFile(join(outDir, name), 'utf8')).toBe('cached');
		} finally {
			await first.done();
		}
	});

	test('names change with the source and the settings', async () => {
		let { root, ctx, done } = await setup();
		try {
			let copy = join(root, 'photo.png');
			await copyFile(PHOTO, copy);
			let name = async (attrs: Record<string, string>) => (await images.prepare(copy, images.settings(attrs, {}), ctx)).filename;

			let base = await name({ formats: 'webp' });
			expect(await name({ formats: 'webp' })).toBe(base);
			expect(await name({ formats: 'webp', quality: '50' })).not.toBe(base);

			await sharp(PHOTO).negate().toFile(join(root, 'flipped.png'));
			await copyFile(join(root, 'flipped.png'), copy);
			let fresh = images.context({ ...ctx });
			expect((await images.prepare(copy, images.settings({ formats: 'webp' }, {}), fresh)).filename).not.toBe(base);
		} finally {
			await done();
		}
	});

	test('copies svg and gif as they are, with their size when known', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			let opts = images.settings({}, {});
			expect(await images.prepare(LOGO, opts, ctx)).toEqual({ filename: 'logo.0123abcd.svg', width: 120, height: 40, variants: [] });
			expect(await images.prepare(DIAGRAM, opts, ctx)).toEqual({ filename: 'diagram.0123abcd.svg', width: 300, height: 150, variants: [] });
			expect(await images.prepare(SPIN, opts, ctx)).toEqual({ filename: 'spin.0123abcd.gif', width: 2, height: 3, variants: [] });
			expect((await readdir(outDir)).sort()).toEqual(['diagram.0123abcd.svg', 'logo.0123abcd.svg', 'spin.0123abcd.gif']);
		} finally {
			await done();
		}
	});

	test('reads svg sizes from width, height, and viewBox', async () => {
		let { root, ctx, done } = await setup();
		try {
			let size = async (svg: string) => {
				let file = join(root, 'x.svg');
				await writeFile(file, svg);
				let { width, height } = await images.prepare(file, images.settings({}, {}), ctx);
				return [width, height];
			};
			expect(await size('<svg width="10.4px" height=\'20\'></svg>')).toEqual([10, 20]);
			expect(await size('<svg width="100%" viewBox="0 0 30 15"></svg>')).toEqual([30, 15]);
			expect(await size('<svg width="60" viewBox="0,0,30,15"></svg>')).toEqual([60, 30]);
			expect(await size('<?xml version="1.0"?><svg height="5em"></svg>')).toEqual([undefined, undefined]);
		} finally {
			await done();
		}
	});

	test('copies an animated image as it is', async () => {
		let { root, ctx, done } = await setup();
		try {
			let file = join(root, 'anim.webp');
			let frame = (background: string) => sharp({ create: { width: 4, height: 8, channels: 3, background } }).png().toBuffer();
			await sharp([await frame('#000'), await frame('#fff')], { join: { animated: true } }).webp().toFile(file);
			let info = await images.prepare(file, images.settings({}, {}), ctx);
			expect(info).toEqual({ filename: 'anim.0123abcd.webp', width: 4, height: 8, variants: [] });
		} finally {
			await done();
		}
	});

	test('fails on an image it cannot read', async () => {
		let { root, ctx, done } = await setup();
		try {
			let file = join(root, 'broken.jpg');
			await writeFile(file, 'not a jpeg');
			await expect(images.prepare(file, images.settings({}, {}), ctx)).rejects.toThrow(`Cannot read image "${file}"`);
		} finally {
			await done();
		}
	});
});

describe('render', () => {
	let url = (name: string) => '/docs/' + name;
	let info: images.Info = {
		filename: 'a-800.2.webp',
		width: 800,
		height: 600,
		variants: [
			{ format: 'avif', width: 640, filename: 'a-640.1.avif' },
			{ format: 'avif', width: 800, filename: 'a-800.1.avif' },
			{ format: 'webp', width: 640, filename: 'a-640.2.webp' },
			{ format: 'webp', width: 800, filename: 'a-800.2.webp' },
		],
	};

	test('puts every format but the last in a <source>, and the last in the <img>', () => {
		let html = images.render(info, { sizes: '50vw', alt: 'A "b"', hidden: true, loading: 'lazy' }, url);
		expect(html).toBe(
			'<source type="image/avif" srcset="/docs/a-640.1.avif 640w, /docs/a-800.1.avif 800w" sizes="50vw"/>'
			+ '<img src="/docs/a-800.2.webp" srcset="/docs/a-640.2.webp 640w, /docs/a-800.2.webp 800w" sizes="50vw" alt="A &quot;b&quot;" hidden loading="lazy" width="800" height="600"/>',
		);
	});

	test('fills the missing dimension from the aspect ratio', () => {
		let one = { ...info, variants: info.variants.slice(2) };
		expect(images.render(one, { width: '400' }, url)).toContain(' width="400" height="300"/>');
		expect(images.render(one, { height: '30' }, url)).toContain(' width="40" height="30"/>');
		expect(images.render(one, { width: '1', height: '2' }, url)).toContain(' width="1" height="2"/>');
		expect(images.render(one, { width: '50%' }, url)).toContain(' width="50%"/>');
	});

	test('a copied file gets no srcset or sizes', () => {
		let html = images.render({ filename: 'x.1.svg', width: 3, height: 2, variants: [] }, { sizes: 'auto, 100vw', alt: '' }, url);
		expect(html).toBe('<img src="/docs/x.1.svg" alt="" width="3" height="2"/>');
		expect(images.render({ filename: 'x.1.ico', variants: [] }, { alt: '' }, url)).toBe('<img src="/docs/x.1.ico" alt=""/>');
	});
});
