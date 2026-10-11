import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import * as images from './images';

const FIXTURE = join(import.meta.dirname, '../../test/fixtures/site-image');
const PHOTO = join(FIXTURE, 'content/blog/post/photo.png');
const PORTRAIT = join(FIXTURE, 'content/blog/post/portrait.jpg');
const DIAGRAM = join(FIXTURE, 'content/blog/post/diagram.svg');
const LOGO = join(FIXTURE, 'assets/img/logo.svg');
const SPIN = join(FIXTURE, 'assets/img/spin.gif');

async function meta(file: string | Uint8Array) {
	return new Bun.Image(typeof file === 'string' ? await Bun.file(file).bytes() : file).metadata();
}

// Runs `test` as if bongo ran under Node, where there is no Bun.Image.
async function withoutBunImage<T>(test: () => Promise<T>): Promise<T> {
	let Image = Bun.Image;
	Object.defineProperty(Bun, 'Image', { value: undefined });
	try {
		return await test();
	} finally {
		Object.defineProperty(Bun, 'Image', { value: Image });
	}
}

async function canEncodeAvif(): Promise<boolean> {
	let png = await Bun.file(PHOTO).bytes();
	let prev = Bun.Image.backend;
	Bun.Image.backend = 'system';
	try {
		var run = new Bun.Image(png).resize(8).avif().bytes();
	} finally {
		Bun.Image.backend = prev;
	}
	return run.then(() => true, () => false);
}

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
			widths: [640, 960, 1280, 1920, 2880],
			formats: ['webp', 'original'],
			quality: { avif: 50, webp: 80, jpeg: 80 },
		});
	});

	test('config overrides the defaults', () => {
		let out = images.settings({}, { widths: [300, 100, 300], formats: ['jpeg', 'webp', 'jpeg'], quality: { jpeg: 70 } });
		expect(out).toEqual({ widths: [100, 300], formats: ['jpeg', 'webp'], quality: { avif: 50, webp: 80, jpeg: 70 } });
	});

	test('a number quality applies to every lossy format', () => {
		expect(images.settings({}, { quality: 60 }).quality).toEqual({ avif: 60, webp: 60, jpeg: 60 });
	});

	test('attributes override the config', () => {
		let out = images.settings({ widths: '320, 640', formats: 'webp', quality: '60' }, { widths: [1], formats: ['avif'] });
		expect(out).toEqual({ widths: [320, 640], formats: ['webp'], quality: { avif: 60, webp: 60, jpeg: 60 } });
	});

	test('rejects bad values', () => {
		expect(() => images.settings({ widths: '0' }, {})).toThrow('Invalid widths "0"');
		expect(() => images.settings({ widths: 'big' }, {})).toThrow('Invalid widths "big"');
		expect(() => images.settings({ widths: true }, {})).toThrow('Invalid widths');
		expect(() => images.settings({}, { widths: [] })).toThrow('Invalid widths');
		expect(() => images.settings({ formats: 'jpg' }, {})).toThrow('Unknown image format "jpg"; use avif, webp, jpeg, png, or original');
		expect(() => images.settings({ quality: '101' }, {})).toThrow('Invalid quality "101"');
		expect(() => images.settings({}, { quality: { webp: 0 } })).toThrow('Invalid quality "0"');
	});
});

describe('prepare', () => {
	test('encodes webp and the original format at each width, never above the source width', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			let info = await images.prepare(PHOTO, images.settings({}, {}), ctx);
			expect([info.width, info.height]).toEqual([800, 600]);
			expect(info.variants.map(v => [v.format, v.width])).toEqual([['webp', 640], ['webp', 800], ['png', 640], ['png', 800]]);
			expect(info.filename).toBe(info.variants[3].filename);

			for (let v of info.variants) {
				expect(v.filename).toMatch(new RegExp(`^photo-${v.width}\\.[a-f0-9]{8}\\.${v.format}$`));
				expect(await meta(join(outDir, v.filename))).toEqual({ format: v.format, width: v.width, height: v.width * 3 / 4 });
			}
		} finally {
			await done();
		}
	});

	test('keeps a jpeg upright, at its own width when every width is wider', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			let info = await images.prepare(PORTRAIT, images.settings({}, {}), ctx);
			expect([info.width, info.height]).toEqual([400, 600]);
			expect(info.variants.map(v => [v.format, v.width])).toEqual([['webp', 400], ['jpeg', 400]]);
			expect(info.filename).toMatch(/^portrait-400\.[a-f0-9]{8}\.jpg$/);
			expect(await meta(join(outDir, info.filename))).toEqual({ format: 'jpeg', width: 400, height: 600 });
		} finally {
			await done();
		}
	});

	test('a webp source makes webp files only', async () => {
		let { root, ctx, done } = await setup();
		try {
			let file = join(root, 'shot.webp');
			await Bun.write(file, await new Bun.Image(await Bun.file(PHOTO).bytes()).webp().bytes());
			let info = await images.prepare(file, images.settings({}, {}), ctx);
			expect(info.variants.map(v => [v.format, v.width])).toEqual([['webp', 640], ['webp', 800]]);
		} finally {
			await done();
		}
	});

	test('writes the same bytes whatever Bun.Image.backend the host chose, and leaves it as it was', async () => {
		let { outDir, ctx, done } = await setup();
		let prev = Bun.Image.backend;
		try {
			Bun.Image.backend = 'system';
			let info = await images.prepare(PORTRAIT, images.settings({ formats: 'webp', widths: '200' }, {}), ctx);
			expect(Bun.Image.backend).toBe('system');

			Bun.Image.backend = 'bun';
			let portable = await new Bun.Image(await Bun.file(PORTRAIT).bytes()).resize(200).webp({ quality: 80 }).bytes();
			expect(Buffer.compare(await readFile(join(outDir, info.filename)), Buffer.from(portable))).toBe(0);
		} finally {
			Bun.Image.backend = prev;
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

			await Bun.write(copy, await new Bun.Image(await Bun.file(PHOTO).bytes()).resize(799).png().bytes());
			let fresh = images.context({ ...ctx });
			expect((await images.prepare(copy, images.settings({ formats: 'webp' }, {}), fresh)).filename).not.toBe(base);
		} finally {
			await done();
		}
	});

	test('avif is opt-in, and fails the build where the machine cannot encode it', async () => {
		let { ctx, done } = await setup();
		try {
			let able = await canEncodeAvif();
			let run = images.prepare(PHOTO, images.settings({ formats: 'avif,webp', widths: '320' }, {}), ctx);
			if (able) {
				let info = await run;
				expect(info.variants.map(v => v.format)).toEqual(['avif', 'webp']);
			} else {
				await expect(run).rejects.toThrow(`Cannot encode "${PHOTO}" as AVIF on this machine. Bun.Image encodes AVIF only on Apple Silicon M3 or newer Macs and on Windows; remove "avif" from formats.`);
			}
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

	test('copies tiff, avif, and heic sources as they are, since Linux cannot read them', async () => {
		let { root, ctx, done } = await setup();
		try {
			for (let ext of ['tiff', 'avif', 'heic']) {
				let file = join(root, `x.${ext}`);
				await writeFile(file, 'not decoded');
				expect(await images.prepare(file, images.settings({}, {}), ctx)).toEqual({ filename: `x.0123abcd.${ext}`, variants: [] });
			}
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

	test('copies animated png and webp as they are, with their size', async () => {
		let { root, ctx, done } = await setup();
		try {
			let png = await readFile(PHOTO);
			let actl = Buffer.from([0, 0, 0, 8, ...Buffer.from('acTL'), 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
			let apng = join(root, 'anim.png');
			await writeFile(apng, Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]));
			expect(await images.prepare(apng, images.settings({}, {}), ctx)).toEqual({ filename: 'anim.0123abcd.png', width: 800, height: 600, variants: [] });

			let webp = Buffer.alloc(30);
			webp.write('RIFF', 0);
			webp.writeUInt32LE(22, 4);
			webp.write('WEBPVP8X', 8);
			webp.writeUInt32LE(10, 16);
			webp[20] = 0x02;
			webp.writeUIntLE(4 - 1, 24, 3);
			webp.writeUIntLE(8 - 1, 27, 3);
			let anim = join(root, 'anim.webp');
			await writeFile(anim, webp);
			expect(await images.prepare(anim, images.settings({}, {}), ctx)).toEqual({ filename: 'anim.0123abcd.webp', width: 4, height: 8, variants: [] });
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

	test('without Bun.Image, copies the original once and notes it once', async () => {
		let { outDir, ctx, done } = await setup();
		try {
			await withoutBunImage(async () => {
				expect(await images.prepare(PHOTO, images.settings({}, {}), ctx)).toEqual({ filename: 'photo.0123abcd.png', variants: [] });
				expect(await images.prepare(PORTRAIT, images.settings({ formats: 'avif' }, {}), ctx)).toEqual({ filename: 'portrait.0123abcd.jpg', variants: [] });
				expect(await images.prepare(LOGO, images.settings({}, {}), ctx)).toEqual({ filename: 'logo.0123abcd.svg', width: 120, height: 40, variants: [] });
			});
			expect([...ctx.notices]).toEqual(['images: copied as-is; resizing them needs Bun, eg: bunx --bun bongo']);
			expect((await readdir(outDir)).sort()).toEqual(['logo.0123abcd.svg', 'photo.0123abcd.png', 'portrait.0123abcd.jpg']);
		} finally {
			await done();
		}
	});
});

describe('serve', () => {
	test('in dev, nothing is encoded until a file is requested', async () => {
		let { outDir, cache, ctx, done } = await setup(true);
		try {
			let info = await images.prepare(PHOTO, images.settings({ formats: 'webp' }, {}), ctx);
			expect(existsSync(outDir)).toBe(false);
			expect(existsSync(cache)).toBe(false);

			let body = await images.serve(info.filename)!;
			expect(await meta(body)).toEqual({ format: 'webp', width: 800, height: 600 });
			expect(await readdir(cache)).toHaveLength(1);
			expect(existsSync(outDir)).toBe(false);
			expect(images.serve('photo-1.00000000.webp')).toBeUndefined();
		} finally {
			await done();
		}
	});

	test('does not serve a source that changed since the build under its old name', async () => {
		let { root, ctx, done } = await setup(true);
		try {
			let copy = join(root, 'photo.png');
			await copyFile(PHOTO, copy);
			let info = await images.prepare(copy, images.settings({ formats: 'webp' }, {}), ctx);
			await Bun.write(copy, await new Bun.Image(await Bun.file(PHOTO).bytes()).resize(799).png().bytes());
			await expect(images.serve(info.filename)!).rejects.toThrow(`"${copy}" changed after the build read it`);
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
