import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, join } from 'node:path';

import * as output from './output';

import type { Images } from 'bongo';
import type { Attrs } from './tags';

type Format = Images.Format;
type Quality = Partial<Record<Format, number>>;
type Size = { width?: number; height?: number };

export type Settings = {
	widths: number[];
	formats: (Format | 'original')[];
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

type Source =
	| { type: 'still'; hash: string; width: number; height: number; format: Format }
	| { type: 'copy'; width?: number; height?: number }
	| { type: 'unprocessed' };

type Job = {
	file: string;
	hash: string;
	key: string;
	format: Format;
	width: number;
	options: { quality?: number; progressive?: boolean };
	cache: string;
	filename: string;
};

export type Context = {
	outDir: string;
	sink: output.Sink;
	cache: string;
	dev: boolean;
	emit(file: string): Promise<string>;
	jobs: Map<string, Job>;
	sources: Map<string, Promise<Source>>;
	notices: Set<string>;
};

const EXTENSION: Record<Format, string> = { avif: 'avif', webp: 'webp', jpeg: 'jpg', png: 'png' };
const QUALITY: Quality = { avif: 50, webp: 80, jpeg: 80 };
const LOSSY: Format[] = ['avif', 'webp', 'jpeg'];
const RASTER = /\.(jpe?g|png|webp)$/i;
const LIMIT = availableParallelism();
const DAY = 24 * 60 * 60 * 1000;
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const UNPROCESSED = 'images: copied as-is; resizing them needs Bun, eg: bunx --bun bongo';

let SERVED: Map<string, Job> = new Map();
let INFLIGHT: Map<string, Promise<string>> = new Map();
let AVIF: Promise<boolean> | undefined;
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

// Bun.Image exists only in the Bun runtime.
function codec(): typeof Bun.Image | undefined {
	return typeof Bun === 'undefined' ? undefined : Bun.Image;
}

function unreadable(file: string, err: unknown): Error {
	let reason = err instanceof Error ? err.message : String(err);
	return new Error(`Cannot read image "${file}": ${reason}`, { cause: err });
}

function noAvif(file: string): Error {
	return new Error(`Cannot encode "${file}" as AVIF on this machine. Bun.Image encodes AVIF only on Apple Silicon M3 or newer Macs and on Windows; remove "avif" from formats.`);
}

function unsupported(err: unknown): boolean {
	return err instanceof Error && 'code' in err && err.code === 'ERR_IMAGE_FORMAT_UNSUPPORTED';
}

// JPEG, PNG, and WebP use the portable backend, so their bytes are the same on every machine; AVIF needs the OS encoder.
function encode(image: Bun.Image, format: Format, options: Job['options']): Promise<Uint8Array> {
	if (format === 'avif') image.avif(options);
	else if (format === 'webp') image.webp(options);
	else if (format === 'jpeg') image.jpeg(options);
	else image.png();

	let prev = Bun.Image.backend;
	Bun.Image.backend = format === 'avif' ? 'system' : 'bun';
	try {
		return image.bytes();
	} finally {
		Bun.Image.backend = prev;
	}
}

function avif(Image: typeof Bun.Image): Promise<boolean> {
	return AVIF ||= encode(new Image(Buffer.from(PIXEL, 'base64')), 'avif', {}).then(() => true, err => {
		if (unsupported(err)) return false;
		throw err;
	});
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

// The canvas of an animated PNG or WebP, which resizing would flatten; undefined for a still image.
function animation(bytes: Buffer): Size | undefined {
	if (bytes.toString('latin1', 1, 4) === 'PNG') {
		for (let at = 8; at + 8 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) {
			let type = bytes.toString('latin1', at + 4, at + 8);
			if (type === 'IDAT') return;
			if (type === 'acTL' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
		}
		return;
	}
	if (bytes.length >= 30 && bytes.toString('latin1', 8, 16) === 'WEBPVP8X' && bytes[20] & 0x02) {
		return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
	}
}

function source(file: string, ctx: Context): Promise<Source> {
	let hit = ctx.sources.get(file);
	if (hit) return hit;
	hit = slot(async (): Promise<Source> => {
		let bytes = await readFile(file);
		let canvas = animation(bytes);
		if (canvas) return { type: 'copy', ...canvas };

		let Image = codec();
		if (!Image) return { type: 'unprocessed' };
		try {
			var meta = await new Image(bytes).metadata();
		} catch (err) {
			throw unreadable(file, err);
		}
		let { width, height, format } = meta;
		if (format !== 'jpeg' && format !== 'png' && format !== 'webp') return { type: 'copy', width, height };
		return { type: 'still', hash: sha256(bytes), width, height, format };
	});
	ctx.sources.set(file, hit);
	return hit;
}

async function write(job: Job, out: string): Promise<string> {
	let bytes = await readFile(job.file);
	if (sha256(bytes) !== job.hash) throw new Error(`"${job.file}" changed after the build read it`);

	let Image = codec();
	if (!Image) throw new Error(`Resizing "${job.file}" needs Bun`);
	try {
		var data = await encode(new Image(bytes).resize(job.width, undefined, { withoutEnlargement: true }), job.format, job.options);
	} catch (err) {
		throw unsupported(err) ? noAvif(job.file) : unreadable(job.file, err);
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
// A hit older than a day gets its time of last use, which `prune()` reads, set to now.
async function ensure(job: Job): Promise<string> {
	let out = join(job.cache, `${job.key}.${EXTENSION[job.format]}`);
	let used = await stat(out).then(info => info.mtimeMs, () => undefined);
	if (used !== undefined) {
		if (Date.now() - used > DAY) await utimes(out, new Date(), new Date()).catch(() => {});
		return out;
	}
	let hit = INFLIGHT.get(out);
	if (hit) return hit;
	hit = slot(() => write(job, out)).finally(() => INFLIGHT.delete(out));
	INFLIGHT.set(out, hit);
	return hit;
}

// Another build may prune the entry between ensure() and its use; then it is encoded again.
async function use<T>(job: Job, read: (file: string) => Promise<T>): Promise<T> {
	try {
		return await read(await ensure(job));
	} catch (err) {
		if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
		return read(await ensure(job));
	}
}

/**
 * Resolve processing settings: element attributes, then the `$images` config, then the defaults.
 * `original` in formats stands for the format of each source.
 * @example images.settings({ widths: '320,640' }, { formats: ['webp'] }) //=> { widths: [320, 640], formats: ['webp'], quality: { avif: 50, webp: 80, jpeg: 80 } }
 */
export function settings(attrs: Attrs, options: Images.Options): Settings {
	let widths = attrs.widths === undefined ? options.widths ?? [640, 960, 1280, 1920, 2880] : list(attrs.widths).map(Number);
	if (!widths.length || !widths.every(w => Number.isInteger(w) && w > 0)) {
		throw new Error(`Invalid widths "${attrs.widths ?? widths}"`);
	}

	let names = attrs.formats === undefined ? options.formats ?? ['webp', 'original'] : list(attrs.formats);
	if (!names.length) throw new Error(`Invalid formats "${attrs.formats ?? names}"`);

	let formats: Settings['formats'] = [];
	for (let name of names) {
		if (name !== 'original' && !known(name)) throw new Error(`Unknown image format "${name}"; use avif, webp, jpeg, png, or original`);
		if (!formats.includes(name)) formats.push(name);
	}

	let value = attrs.quality === undefined ? options.quality : attrs.quality === true ? NaN : Number(attrs.quality);
	let quality: Quality = {};
	for (let format of LOSSY) {
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
export function context(opts: Pick<Context, 'outDir' | 'cache' | 'dev' | 'emit'> & { sink?: output.Sink }): Context {
	return { ...opts, sink: opts.sink ?? output.folder(opts.outDir), jobs: new Map(), sources: new Map(), notices: new Set() };
}

/**
 * Write the resized copies of an image, from the cache when it has them. In dev, list them for `serve()` instead.
 * Without Bun.Image, as under Node, an image is copied as it is and the flush gets one notice.
 * SVG, GIF, animated, and other images are copied as they are, with their size when known.
 * @example let info = await images.prepare('/site/assets/hero.jpg', images.settings({}, {}), ctx)
 */
export async function prepare(file: string, settings: Settings, ctx: Context): Promise<Info> {
	let src: Source = RASTER.test(file) ? await source(file, ctx) : { type: 'copy', ...await measure(file) };
	if (src.type === 'unprocessed') ctx.notices.add(UNPROCESSED);
	if (src.type !== 'still') {
		let size = src.type === 'copy' ? { width: src.width, height: src.height } : {};
		return { filename: await ctx.emit(file), ...size, variants: [] };
	}

	let { hash, width, height } = src;
	let formats: Format[] = [];
	for (let choice of settings.formats) {
		let format = choice === 'original' ? src.format : choice;
		if (!formats.includes(format)) formats.push(format);
	}
	if (formats.includes('avif') && !await avif(Bun.Image)) throw noAvif(file);

	let widths = settings.widths.filter(w => w < width);
	if (widths.length < settings.widths.length) widths.push(width);

	let name = basename(file, extname(file));
	let encoder = `Bun.Image ${Bun.version}`;
	let jobs: Job[] = [];
	for (let format of formats) {
		let quality = settings.quality[format];
		let options = format === 'jpeg' ? { quality, progressive: true } : { quality };
		let backend = format === 'avif' ? 'system' : 'bun';
		for (let w of widths) {
			let key = sha256(JSON.stringify([hash, encoder, backend, format, w, options])).slice(0, 16);
			let filename = `${name}-${w}.${key.slice(0, 8)}.${EXTENSION[format]}`;
			jobs.push({ file, hash, key, format, width: w, options, cache: ctx.cache, filename });
		}
	}

	let fresh = jobs.filter(job => !ctx.jobs.has(job.filename));
	for (let job of fresh) ctx.jobs.set(job.filename, job);

	if (ctx.dev) {
		for (let job of jobs) SERVED.set(job.filename, job);
	} else {
		await Promise.all(fresh.map(job => use(job, file => ctx.sink.copy(file, join(ctx.outDir, job.filename)))));
	}

	let variants = jobs.map(job => ({ format: job.format, width: job.width, filename: job.filename }));
	return { filename: variants[variants.length - 1].filename, width, height, variants };
}

/**
 * Bytes of a file that a dev flush listed, by its output name, encoded on first request. Undefined for other names.
 * The source must still have the contents the name was made from.
 * @example let body = await images.serve('hero-640.3f9a1c2e.webp')
 */
export function serve(filename: string): Promise<Buffer> | undefined {
	let job = SERVED.get(filename);
	return job && use(job, file => readFile(file));
}

/**
 * Delete cache entries that no build has used for `$images.prune` days, 30 by default; `false` keeps them all.
 * It checks at most once a day. A build that loses an entry to a prune running in another build encodes it again.
 * @example await images.prune('node_modules/.cache/bongo/images', config.$images)
 */
export async function prune(dir: string, options: Images.Options): Promise<void> {
	let days = options.prune ?? 30;
	if (days === false) return;
	if (!(days > 0 && Number.isFinite(days))) throw new Error(`Invalid $images.prune "${days}"; use a number of days, or false`);

	let marker = join(dir, '.pruned');
	let checked = await stat(marker).then(info => info.mtimeMs, () => 0);
	if (Date.now() - checked < DAY) return;
	try {
		var names = await readdir(dir);
	} catch {
		return;
	}
	await writeFile(marker, '');

	let cutoff = Date.now() - days * DAY;
	await Promise.all(names.filter(name => name !== '.pruned').map(async name => {
		let file = join(dir, name);
		let used = await stat(file).then(info => info.mtimeMs, () => Infinity);
		if (used < cutoff) await rm(file, { force: true });
	}));
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
