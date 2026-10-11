import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, join } from 'node:path';

import * as fs from './fs';

import type { Images } from 'bongo';
import type sharp from 'sharp';
import type { Attrs } from './tags';

type Sharp = typeof sharp;
type Format = Images.Format;
type Quality = Partial<Record<Format, number>>;
type Size = { width?: number; height?: number };

export type Settings = {
	widths: number[];
	formats: Format[];
	quality: Quality;
};

export type Variant = {
	format: Format;
	width: number;
	filename: string;
};

export type Info = Size & {
	filename: string;
	variants: Variant[];
};

type Source = {
	hash: string;
	width: number;
	height: number;
	animated: boolean;
	encoder: string;
};

type Job = {
	file: string;
	hash: string;
	key: string;
	format: Format;
	width: number;
	options: { quality?: number; mozjpeg?: boolean };
	cache: string;
	filename: string;
};

export type Context = {
	outDir: string;
	cache: string;
	dev: boolean;
	emit(file: string): Promise<string>;
	jobs: Map<string, Job>;
	sources: Map<string, Promise<Source>>;
};

const EXTENSION: Record<Format, string> = { avif: 'avif', webp: 'webp', jpeg: 'jpg', png: 'png' };
const QUALITY: Quality = { avif: 50, webp: 80, jpeg: 80 };
const RASTER = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const LIMIT = availableParallelism();

let SHARP: Sharp | undefined;
let SERVED: Map<string, Job> = new Map();
let INFLIGHT: Map<string, Promise<string>> = new Map();
let active = 0;
let waiting: (() => void)[] = [];

function str(value: Attrs[string] | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function known(name: string): name is Format {
	return Object.hasOwn(EXTENSION, name);
}

function sha256(input: string | Uint8Array): string {
	return createHash('sha256').update(input).digest('hex');
}

function list(value: Attrs[string]): string[] {
	return value === true ? [] : value.split(/[\s,]+/).filter(Boolean);
}

function serialize(attrs: [string, Attrs[string] | undefined][]): string {
	let out = '';
	for (let [name, value] of attrs) {
		if (value === undefined) continue;
		out += value === true ? ` ${name}` : ` ${name}="${value.replace(/"/g, '&quot;')}"`;
	}
	return out;
}

// Bounds how many images are decoded at once, so a large site does not hold every source in memory.
async function slot<T>(run: () => Promise<T>): Promise<T> {
	if (active < LIMIT) active++;
	else await new Promise<void>(next => waiting.push(next));
	try {
		return await run();
	} finally {
		let next = waiting.shift();
		if (next) next();
		else active--;
	}
}

async function load(file: string): Promise<Sharp> {
	try {
		return SHARP ||= (await import('sharp')).default;
	} catch (err) {
		throw new Error(`Processing "${file}" needs the "sharp" package: bun add -d sharp`, { cause: err });
	}
}

function unreadable(file: string, err: unknown): Error {
	let reason = err instanceof Error ? err.message : String(err);
	return new Error(`Cannot read image "${file}": ${reason}`, { cause: err });
}

function svg(text: string): Size {
	let tag = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(text)?.[1] ?? '';
	let attr = (name: string) => {
		let m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
		return m ? (m[1] ?? m[2]) : undefined;
	};
	let px = (name: string) => {
		let value = attr(name);
		return value && /^\s*(\d*\.)?\d+\s*(px)?\s*$/.test(value) ? parseFloat(value) : 0;
	};

	let width = px('width'), height = px('height');
	if (width && height) return { width: Math.round(width), height: Math.round(height) };

	let box = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
	if (box.length !== 4 || !(box[2] > 0 && box[3] > 0)) return {};
	let ratio = box[2] / box[3];
	if (width) return { width: Math.round(width), height: Math.round(width / ratio) };
	if (height) return { width: Math.round(height * ratio), height: Math.round(height) };
	return { width: Math.round(box[2]), height: Math.round(box[3]) };
}

async function measure(file: string): Promise<Size> {
	if (/\.svg$/i.test(file)) return svg(await readFile(file, 'utf8'));
	if (!/\.gif$/i.test(file)) return {};
	let head = await readFile(file);
	if (head.toString('ascii', 0, 3) !== 'GIF' || head.length < 10) return {};
	return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
}

function source(file: string, ctx: Context): Promise<Source> {
	let hit = ctx.sources.get(file);
	if (hit) return hit;
	hit = slot(async () => {
		let sharp = await load(file);
		let bytes = await readFile(file);
		try {
			var meta = await sharp(bytes).metadata();
		} catch (err) {
			throw unreadable(file, err);
		}
		return {
			hash: sha256(bytes),
			width: meta.autoOrient.width,
			height: meta.autoOrient.height,
			animated: (meta.pages ?? 1) > 1,
			encoder: `sharp@${sharp.versions.sharp} vips@${sharp.versions.vips}`,
		};
	});
	ctx.sources.set(file, hit);
	return hit;
}

async function encode(job: Job, out: string): Promise<string> {
	let bytes = await readFile(job.file);
	if (sha256(bytes) !== job.hash) throw new Error(`"${job.file}" changed after the build read it`);

	let sharp = await load(job.file);
	try {
		var data = await sharp(bytes).autoOrient().resize({ width: job.width }).toFormat(job.format, job.options).toBuffer();
	} catch (err) {
		throw unreadable(job.file, err);
	}

	await mkdir(job.cache, { recursive: true });
	let tmp = `${out}.${randomBytes(4).toString('hex')}.tmp`;
	try {
		await writeFile(tmp, data);
		await rename(tmp, out);
	} catch (err) {
		await rm(tmp, { force: true });
		throw err;
	}
	return out;
}

// Path of the cached encode for a job, encoding it first when the cache misses.
function ensure(job: Job): Promise<string> {
	let out = join(job.cache, `${job.key}.${EXTENSION[job.format]}`);
	if (fs.exists(out)) return Promise.resolve(out);
	let hit = INFLIGHT.get(out);
	if (hit) return hit;
	hit = slot(() => encode(job, out)).finally(() => INFLIGHT.delete(out));
	INFLIGHT.set(out, hit);
	return hit;
}

/**
 * Resolve processing settings: element attributes, then the `$images` config, then the defaults.
 * @example images.settings({ widths: '320,640' }, { formats: ['webp'] }) //=> { widths: [320, 640], formats: ['webp'], quality: { webp: 80 } }
 */
export function settings(attrs: Attrs, options: Images.Options): Settings {
	let widths = attrs.widths === undefined ? options.widths ?? [640, 1280, 1920] : list(attrs.widths).map(Number);
	if (!widths.length || !widths.every(w => Number.isInteger(w) && w > 0)) {
		throw new Error(`Invalid widths "${attrs.widths ?? widths}"`);
	}

	let names = attrs.formats === undefined ? options.formats ?? ['avif', 'webp'] : list(attrs.formats);
	if (!names.length) throw new Error(`Invalid formats "${attrs.formats ?? names}"`);

	let formats: Format[] = [];
	for (let name of names) {
		if (!known(name)) throw new Error(`Unknown image format "${name}"; use avif, webp, jpeg, or png`);
		if (!formats.includes(name)) formats.push(name);
	}

	let value = attrs.quality === undefined ? options.quality : attrs.quality === true ? NaN : Number(attrs.quality);
	let quality: Quality = {};
	for (let format of formats) {
		let q = typeof value === 'number' ? value : value?.[format] ?? QUALITY[format];
		if (q === undefined) continue;
		if (!Number.isInteger(q) || q < 1 || q > 100) throw new Error(`Invalid quality "${attrs.quality ?? q}"`);
		quality[format] = q;
	}

	return { widths: [...new Set(widths)].sort((a, b) => a - b), formats, quality };
}

/**
 * Shared state for the images of one flush: each source is read once, and each output written once.
 * @example let ctx = images.context({ outDir: 'public', cache: 'node_modules/.cache/bongo/images', dev: false, emit })
 */
export function context(opts: Pick<Context, 'outDir' | 'cache' | 'dev' | 'emit'>): Context {
	return { ...opts, jobs: new Map(), sources: new Map() };
}

/**
 * Write the resized copies of an image, from the cache when it has them. In dev, list them for `serve()` instead.
 * SVG, GIF, animated, and unknown images are copied as they are, with their size when known.
 * @example let info = await images.prepare('/site/assets/hero.jpg', images.settings({}, {}), ctx)
 */
export async function prepare(file: string, settings: Settings, ctx: Context): Promise<Info> {
	if (!RASTER.test(file)) {
		return { filename: await ctx.emit(file), ...await measure(file), variants: [] };
	}

	let src = await source(file, ctx);
	let size = { width: src.width, height: src.height };
	if (src.animated) return { filename: await ctx.emit(file), ...size, variants: [] };

	let widths = settings.widths.filter(w => w < src.width);
	if (widths.length < settings.widths.length) widths.push(src.width);

	let name = basename(file, extname(file));
	let jobs: Job[] = [];
	for (let format of settings.formats) {
		let quality = settings.quality[format];
		let options = format === 'jpeg' ? { quality, mozjpeg: true } : { quality };
		for (let width of widths) {
			let key = sha256(JSON.stringify([src.hash, src.encoder, format, width, options])).slice(0, 16);
			let filename = `${name}-${width}.${key.slice(0, 8)}.${EXTENSION[format]}`;
			jobs.push({ file, hash: src.hash, key, format, width, options, cache: ctx.cache, filename });
		}
	}

	let fresh = jobs.filter(job => !ctx.jobs.has(job.filename));
	for (let job of fresh) ctx.jobs.set(job.filename, job);

	if (!ctx.dev) {
		await mkdir(ctx.outDir, { recursive: true });
		await Promise.all(fresh.map(async job => copyFile(await ensure(job), join(ctx.outDir, job.filename))));
	}

	let variants = jobs.map(({ format, width, filename }) => ({ format, width, filename }));
	return { filename: variants[variants.length - 1].filename, ...size, variants };
}

/**
 * Make the files of a finished dev flush available to `serve()`.
 * @example images.publish(ctx)
 */
export function publish(ctx: Context): void {
	SERVED = ctx.jobs;
}

/**
 * Bytes of a file the last flush listed, by its output name, encoded on first request. Undefined for other names.
 * @example let body = await images.serve('hero-640.3f9a1c2e.webp')
 */
export function serve(filename: string): Promise<Buffer> | undefined {
	let job = SERVED.get(filename);
	return job && ensure(job).then(file => readFile(file));
}

/**
 * The `<img>` that stands in for an image until its files exist. It holds the presentation attributes, with defaults.
 * @example images.tag(placeholder, { src: 'hero.jpg', alt: '' }, {}) //=> '<img data-bongo-image="…" sizes="auto, 100vw" alt="" loading="lazy" decoding="async"/>'
 */
export function tag(placeholder: string, attrs: Attrs, options: Images.Options): string {
	let own = new Set(['src', 'widths', 'formats', 'quality', 'sizes', 'loading', 'decoding']);
	let loading = str(attrs.loading) ?? (attrs.fetchpriority === 'high' ? 'eager' : 'lazy');
	let sizes = str(attrs.sizes) ?? options.sizes ?? 'auto, 100vw';
	if (loading !== 'lazy') sizes = sizes.replace(/^\s*auto\s*(,\s*|$)/i, '');

	return '<img' + serialize([
		['data-bongo-image', placeholder],
		['sizes', sizes || undefined],
		...Object.entries(attrs).filter(([name]) => !own.has(name)),
		['loading', loading],
		['decoding', str(attrs.decoding) ?? 'async'],
	]) + '/>';
}

/**
 * Final markup for a stand-in `<img>`: one `<source>` per format but the last, then the `<img>` with the last format.
 * A missing `width` or `height` comes from the image, keeping its aspect ratio.
 * @example images.render(info, { alt: '', sizes: '100vw' }, name => '/' + name)
 */
export function render(info: Info, attrs: Attrs, url: (filename: string) => string): string {
	let sizes = str(attrs.sizes);
	let rest = Object.entries(attrs).filter(([name]) => name !== 'sizes' && name !== 'width' && name !== 'height');

	let w = str(attrs.width), h = str(attrs.height);
	if (info.width && info.height) {
		let px = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : 0);
		if (!w && !h) [w, h] = [String(info.width), String(info.height)];
		else if (!h && px(w)) h = String(Math.round(px(w) * info.height / info.width));
		else if (!w && px(h)) w = String(Math.round(px(h) * info.width / info.height));
	}
	let size: [string, string | undefined][] = [['width', w], ['height', h]];

	if (!info.variants.length) {
		return '<img' + serialize([['src', url(info.filename)], ...rest, ...size]) + '/>';
	}

	let formats = [...new Set(info.variants.map(v => v.format))];
	let srcset = (format: Format) => info.variants.filter(v => v.format === format).map(v => `${url(v.filename)} ${v.width}w`).join(', ');
	let sources = formats.slice(0, -1).map(format => '<source' + serialize([['type', `image/${format}`], ['srcset', srcset(format)], ['sizes', sizes]]) + '/>');

	return sources.join('') + '<img' + serialize([
		['src', url(info.filename)],
		['srcset', srcset(formats[formats.length - 1])],
		['sizes', sizes],
		...rest,
		...size,
	]) + '/>';
}
