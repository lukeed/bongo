import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import * as mime from 'mrmime';

import * as fs from './fs';
import * as images from './images';
import * as memo from './memo';

import type { Template } from 'bongo';
import type { ResvgRenderOptions } from '@resvg/resvg-js';
import type { SatoriOptions } from 'satori';

type Format = 'svg' | 'png' | 'jpeg' | 'webp';
type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/** A node of the tree that Satori draws, shaped as a React element. */
export type Node = Element | string;

export type Element = {
	type: string;
	props: { [name: string]: unknown; style?: Record<string, string>; children?: Node | Node[] };
};

/** A font that an `@font-face` rule declares; `src` is a path in `assets/`. */
export type Font = { name: string; src: string; weight: Weight; style: 'normal' | 'italic' };

/** What `$assets.render` asks for: the HTML of its partial, and where the image goes. */
export type Request = {
	html: string;
	/** The partial file, for errors, such as `partials/og/card.hbs`. */
	file: string;
	template: string;
	output?: string;
	options: Template.Render;
	/** The page that asks, for errors. */
	from: string;
	/** Gets each file in `assets/` that the render reads, and its `memo.hash`. */
	loads?: [file: string, hash: string][];
};

type Job = {
	key: string;
	format: Format;
	root: Element;
	fonts: SatoriOptions['fonts'];
	width: number;
	height: number;
	quality?: number;
	cache: string;
};

type Read = { data: Buffer; hash: string; sum: string };

/** One build's renders, by output path. */
export type Context = {
	assets: string;
	cache: string;
	quality: Partial<Record<'jpeg' | 'webp', number>>;
	files: Map<string, { key: string; from: string; make(): Promise<Buffer> }>;
	/** The renders of pages that a narrow rebuild does not render again. */
	seen: Map<string, { key: string; from: string }>;
	reads: Map<string, Promise<Read>>;
	uris: Map<string, Promise<string>>;
};

const FORMATS: Record<string, Format> = { svg: 'svg', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };
const EXTENSION: Record<Format, string> = { svg: 'svg', png: 'png', jpeg: 'jpg', webp: 'webp' };
const INSTALL = 'bun add -d satori @resvg/resvg-js';
const DAY = 24 * 60 * 60 * 1000;
const WEIGHTS: Weight[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const FACE = /@font-face\s*\{([^}]*)\}/gi;
const TAG = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([a-z][\w:.-]*)\s*>|<([a-z][\w:.-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi;
const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', times: '×', copy: '©', reg: '®', trade: '™', larr: '←', rarr: '→',
};
const REMOTE = /^(?:[a-z][\w+.-]*:|\/\/)/i;
const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

let SATORI: Promise<{ draw: typeof import('satori').default; version: string }> | undefined;
let RESVG: Promise<{ Resvg: typeof import('@resvg/resvg-js').Resvg; version: string }> | undefined;
let INFLIGHT: Map<string, Promise<Buffer>> = new Map();

function sha256(input: string | Uint8Array): string {
	return createHash('sha256').update(input).digest('hex');
}

function decode(text: string): string {
	return text.replace(ENTITY, (match, dec?: string, hex?: string, name?: string) => {
		if (name) return Object.hasOwn(NAMED, name) ? NAMED[name] : match;
		let code = parseInt(dec || hex || '', dec ? 10 : 16);
		return code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

// Splits at `sep`, but not inside quotes or parentheses, as in `url(data:a;b), x`.
function split(text: string, sep: string): string[] {
	let out: string[] = [];
	let depth = 0, quote = '', last = 0;
	for (let i = 0; i < text.length; i++) {
		let char = text[i];
		if (quote) quote = char === quote ? '' : quote;
		else if (char === '"' || char === '\'') quote = char;
		else if (char === '(') depth++;
		else if (char === ')') depth--;
		else if (char === sep && depth === 0) out.push(text.slice(last, i)), last = i + 1;
	}
	out.push(text.slice(last));
	return out.map(part => part.trim()).filter(Boolean);
}

function declarations(text: string): Record<string, string> {
	let out: Record<string, string> = {};
	for (let part of split(text, ';')) {
		let at = part.indexOf(':');
		let name = part.slice(0, at).trim().toLowerCase();
		let value = part.slice(at + 1).trim();
		if (at > 0 && value) out[name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
	}
	return out;
}

function unquote(text: string): string {
	return text.trim().replace(/^(['"])(.*)\1$/, '$2');
}

// A path in assets/ for a `src` or `url()` that names a local file; undefined for a data: or remote URL.
function local(src: string): string | undefined {
	if (REMOTE.test(src)) return;
	let raw = src.replace(/[?#].*$/, '');
	try { raw = decodeURIComponent(raw); } catch { /* keep as written */ }
	let path = posix.normalize(raw.replace(/\\/g, '/').replace(/^\/+/, ''));
	if (path === '.') throw new Error(`an empty src names no file`);
	if (path === '..' || path.startsWith('../')) throw new Error(`"${src}" is outside assets/`);
	return path;
}

function font(text: string): Font {
	let rule = declarations(text);
	let name = unquote(split(rule.fontFamily ?? '', ',')[0] ?? '');
	if (!name) throw new Error('@font-face needs a font-family');
	if (!rule.src) throw new Error(`@font-face "${name}" needs a src`);

	let sources = split(rule.src, ',').flatMap(entry => {
		URL_FN.lastIndex = 0;
		let match = /^url\(/i.test(entry) && URL_FN.exec(entry);
		if (!match) return [];
		let url = match[1] ?? match[2] ?? match[3] ?? '';
		let format = /format\(\s*['"]?([\w-]+)/i.exec(entry)?.[1];
		return [{ url, woff2: format ? /^woff2/i.test(format) : /\.woff2$/i.test(url.replace(/[?#].*$/, '')) }];
	});
	let usable = sources.find(source => !source.woff2);
	if (!usable) throw new Error(`@font-face "${name}" has only WOFF2 sources, and Satori cannot read WOFF2; use a WOFF, TTF, or OTF file`);
	let src = local(usable.url);
	if (!src) throw new Error(`@font-face "${name}" src "${usable.url}" must be a file in assets/`);

	let value = (rule.fontWeight ?? 'normal').toLowerCase().split(/\s+/)[0];
	let number = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
	if (!(number >= 1 && number <= 1000)) throw new Error(`@font-face "${name}" font-weight "${rule.fontWeight}" is not a number, normal, or bold`);
	let weight = WEIGHTS[Math.min(8, Math.max(0, Math.round(number / 100) - 1))];
	let style: Font['style'] = /^(italic|oblique)/i.test(rule.fontStyle ?? '') ? 'italic' : 'normal';
	return { name, src, weight, style };
}

/**
 * Read the HTML of a render template: its `@font-face` rules, and its one root element as a tree for Satori.
 * Inline `style` attributes become objects; `<style>` may hold only `@font-face` rules.
 * @example render.parse('<style>@font-face { font-family: A; src: url(fonts/a.woff) }</style><p>hi</p>') //=> { fonts: [{ name: 'A', src: 'fonts/a.woff', weight: 400, style: 'normal' }], root: { type: 'p', props: { children: 'hi' } } }
 */
export function parse(html: string): { fonts: Font[]; root: Element } {
	let fonts: Font[] = [];
	html = html.replace(STYLE, (_, css: string) => {
		let rest = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(FACE, (_, rule: string) => (fonts.push(font(rule)), ''));
		if (rest.trim()) throw new Error('<style> may hold only @font-face rules; set the styles of an element with its style attribute');
		return '';
	});

	type Open = Element & { children: Node[] };
	let top: Node[] = [];
	let stack: Open[] = [];
	let add = (node: Node) => (stack.length ? stack[stack.length - 1].children : top).push(node);
	let text = (value: string) => value.trim() && add(decode(value));

	let last = 0;
	TAG.lastIndex = 0;
	for (let match: RegExpExecArray | null; match = TAG.exec(html);) {
		text(html.slice(last, match.index));
		last = TAG.lastIndex;
		let [, close, open, attrs, slash] = match;
		if (close) {
			if (VOID.has(close.toLowerCase())) continue;
			let at = stack.findLastIndex(item => item.type.toLowerCase() === close.toLowerCase());
			if (at < 0) throw new Error(`</${close}> closes no element`);
			if (at < stack.length - 1) throw new Error(`<${stack[stack.length - 1].type}> is not closed`);
			let [{ type, props, children }] = stack.splice(at);
			add({ type, props: children.length ? { ...props, children: children.length > 1 ? children : children[0] } : props });
			continue;
		}
		if (!open) continue;

		let props: Element['props'] = {};
		ATTR.lastIndex = 0;
		for (let attr: RegExpExecArray | null; attr = ATTR.exec(attrs);) {
			let [, name, ...values] = attr;
			let value = values.find(v => v !== undefined);
			if (name === 'style') props.style = declarations(decode(value ?? ''));
			else props[name] = value === undefined ? true : decode(value);
		}
		if (slash || VOID.has(open.toLowerCase())) add({ type: open, props });
		else stack.push({ type: open, props, children: [] });
	}
	text(html.slice(last));
	if (stack.length) throw new Error(`<${stack[stack.length - 1].type}> is not closed`);

	let [root] = top;
	if (top.length !== 1) throw new Error(`it needs one root element, not ${top.length}`);
	if (typeof root === 'string') throw new Error('it needs one root element, not text');
	return { fonts, root };
}

function texts(node: Node): boolean {
	if (typeof node === 'string') return true;
	let { children } = node.props;
	if (children === undefined) return false;
	return Array.isArray(children) ? children.some(texts) : texts(children);
}

function read(ctx: Context, rel: string): Promise<Read> {
	let hit = ctx.reads.get(rel);
	if (hit) return hit;
	let file = join(ctx.assets, rel);
	fs.assert(file, `Missing "${rel}" asset!`);
	hit = fs.read(file).then(data => ({ data, hash: sha256(data), sum: memo.hash(data) }));
	ctx.reads.set(rel, hit);
	return hit;
}

// One data: URL for each file, shared by every page that uses it.
function uri(ctx: Context, rel: string): Promise<string> {
	let hit = ctx.uris.get(rel);
	if (hit) return hit;
	hit = read(ctx, rel).then(({ data }) => `data:${mime.lookup(rel) || 'application/octet-stream'};base64,${data.toString('base64')}`);
	ctx.uris.set(rel, hit);
	return hit;
}

async function inline(ctx: Context, node: Element, used: Set<string>): Promise<Element> {
	let { style, children, ...props } = node.props;
	let out: Element['props'] = { ...props };

	let src = node.type === 'img' && typeof props.src === 'string' ? props.src : undefined;
	let rel = src === undefined ? undefined : local(src);
	if (rel !== undefined) {
		used.add(rel);
		out.src = await uri(ctx, rel);
	}
	if (style) {
		let entries = await Promise.all(Object.entries(style).map(async ([name, value]): Promise<[string, string]> => {
			let parts: Promise<string>[] = [];
			value.replace(URL_FN, (match, a?: string, b?: string, c?: string) => {
				let rel = local(a ?? b ?? c ?? '');
				if (rel !== undefined) used.add(rel);
				parts.push(rel === undefined ? Promise.resolve(match) : uri(ctx, rel).then(data => `url("${data}")`));
				return match;
			});
			let found = await Promise.all(parts);
			return [name, found.length ? value.replace(URL_FN, () => found.shift() ?? '') : value];
		}));
		out.style = Object.fromEntries(entries);
	}
	let child = (node: Node) => typeof node === 'string' ? node : inline(ctx, node, used);
	if (children !== undefined) out.children = Array.isArray(children) ? await Promise.all(children.map(child)) : await child(children);
	return { type: node.type, props: out };
}

function missing(name: string, err: unknown): Error {
	return new Error(`$assets.render needs the "${name}" package; install it with: ${INSTALL}`, { cause: err });
}

function satori(): NonNullable<typeof SATORI> {
	return SATORI ||= Promise.all([
		import('satori'),
		import('satori/package.json', { with: { type: 'json' } }),
	]).then(([mod, pkg]) => ({ draw: mod.default, version: pkg.default.version }), err => {
		SATORI = undefined;
		throw missing('satori', err);
	});
}

function resvg(): NonNullable<typeof RESVG> {
	return RESVG ||= Promise.all([
		import('@resvg/resvg-js'),
		import('@resvg/resvg-js/package.json', { with: { type: 'json' } }),
	]).then(([mod, pkg]) => ({ Resvg: mod.Resvg, version: pkg.default.version }), err => {
		RESVG = undefined;
		throw missing('@resvg/resvg-js', err);
	});
}

/**
 * The options of each `new Resvg`. Satori draws text as paths, so resvg needs no fonts; by default, each `new Resvg` reads every font of the system, about 120 ms per image.
 * @example new Resvg(svg, raster(1200))
 */
export function raster(width: number): ResvgRenderOptions {
	return { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } };
}

async function draw(job: Job): Promise<Buffer> {
	let { draw } = await satori();
	let svg = await draw(job.root, { width: job.width, height: job.height, fonts: job.fonts });
	if (job.format === 'svg') return Buffer.from(svg);

	let { Resvg } = await resvg();
	let png = new Resvg(svg, raster(job.width)).render().asPng();
	if (job.format === 'png') return png;

	let options = job.format === 'jpeg' ? { quality: job.quality, progressive: true } : { quality: job.quality };
	return Buffer.from(await images.encode(new Bun.Image(png), job.format, options));
}

// The bytes of a job, from the cache when it has them. A hit older than a day gets its time of last use, which `images.prune()` reads, set to now.
function make(job: Job): Promise<Buffer> {
	let out = join(job.cache, `${job.key}.${EXTENSION[job.format]}`);
	let hit = INFLIGHT.get(out);
	if (hit) return hit;
	hit = (async () => {
		let used = await stat(out).then(info => info.mtimeMs, () => undefined);
		if (used !== undefined) {
			if (Date.now() - used > DAY) await utimes(out, new Date(), new Date()).catch(() => {});
			let cached = await readFile(out).catch(() => undefined);
			if (cached) return cached;
		}
		let data = await images.slot(() => draw(job));
		await mkdir(job.cache, { recursive: true });
		let tmp = `${out}.${randomBytes(4).toString('hex')}.tmp`;
		try {
			await writeFile(tmp, data);
			await rename(tmp, out);
		} catch (err) {
			await rm(tmp, { force: true });
			throw err;
		}
		return data;
	})().finally(() => INFLIGHT.delete(out));
	INFLIGHT.set(out, hit);
	return hit;
}

/**
 * Shared state for the renders of one build.
 * @example let ctx = render.context({ assets: 'assets', cache: 'node_modules/.cache/bongo/render', quality: { jpeg: 80, webp: 80 } })
 */
export function context(opts: Pick<Context, 'assets' | 'cache' | 'quality'>): Context {
	return { ...opts, files: new Map(), seen: new Map(), reads: new Map(), uris: new Map() };
}

/**
 * Add one render to the build, and return the path of the image in the output folder. `ctx.files.get(path).make()` makes its bytes.
 * The extension of `output` picks the format; without `output`, the file is a PNG named from its template and content.
 * @example await render.add(ctx, { html, file: 'partials/og.hbs', template: 'og', output: '/og/home.png', options: {}, from: '/' }) //=> 'og/home.png'
 */
export async function add(ctx: Context, request: Request): Promise<string> {
	let { html, file, template, output, options, from, loads } = request;
	let label = output ?? template;
	let width = options.width ?? 1200, height = options.height ?? 630;
	for (let [name, value] of [['width', width], ['height', height]] as const) {
		if (!Number.isInteger(value) || value < 1) throw new Error(`Cannot render "${label}": Invalid ${name} "${value}"; use a whole number of pixels`);
	}

	let path = output === undefined ? undefined : posix.normalize(output.replace(/\\/g, '/').replace(/^\/+/, ''));
	if (path !== undefined && (REMOTE.test(output ?? '') || path === '..' || path.startsWith('../') || path.endsWith('/'))) {
		throw new Error(`Cannot render "${output}": the path leaves the site; use a path such as "og/home.png"`);
	}
	let format = path === undefined ? 'png' : FORMATS[posix.extname(path).slice(1).toLowerCase()];
	if (!format) throw new Error(`Cannot render "${output}": use .svg, .png, .jpg, or .webp`);
	if ((format === 'jpeg' || format === 'webp') && typeof Bun === 'undefined') {
		throw new Error(`Cannot render "${output}": JPEG and WebP need Bun, since Bun.Image encodes them; use .png or .svg, or run bongo with Bun`);
	}

	let used: Set<string> = new Set();
	try {
		let parsed = parse(html);
		parsed.fonts.forEach(face => used.add(face.src));
		if (!parsed.fonts.length && texts(parsed.root)) throw new Error('it has text, but declares no fonts; add an @font-face rule in a <style> element');
		var root = await inline(ctx, parsed.root, used);
		var fonts = await Promise.all(parsed.fonts.map(async ({ src, ...face }) => {
			let { data, hash } = await read(ctx, src);
			if (data.toString('latin1', 0, 4) === 'wOF2') throw new Error(`"${src}" is WOFF2, which Satori cannot read; use a WOFF, TTF, or OTF file`);
			return { ...face, data, hash };
		}));
	} catch (err) {
		let reason = err instanceof Error ? err.message : String(err);
		throw new Error(`Cannot render "${label}" from ${file}: ${reason}`, { cause: err });
	}
	for (let rel of used) loads?.push([join(ctx.assets, rel), (await read(ctx, rel)).sum]);

	let engine = [`satori ${(await satori()).version}`];
	if (format !== 'svg') engine.push(`resvg ${(await resvg()).version}`);
	if (format === 'jpeg' || format === 'webp') engine.push(`Bun.Image ${Bun.version}`);
	let quality = format === 'jpeg' || format === 'webp' ? ctx.quality[format] : undefined;
	let key = sha256(JSON.stringify([engine, format, width, height, quality, root, fonts.map(face => [face.name, face.weight, face.style, face.hash])])).slice(0, 16);

	let name = path ?? `${posix.basename(template)}.${key.slice(0, 8)}.png`;
	let prev = ctx.files.get(name) ?? ctx.seen.get(name);
	if (prev && prev.key !== key) throw new Error(`"${name}" renders twice with different content, from ${prev.from} and ${from}`);
	if (!ctx.files.has(name)) {
		let job: Job = { key, format, root, fonts: fonts.map(({ hash, ...face }) => face), width, height, quality, cache: ctx.cache };
		ctx.files.set(name, {
			key,
			from,
			make: () => make(job).catch(err => {
				let reason = err instanceof Error ? err.message : String(err);
				throw new Error(`Cannot render "${name}" from ${file}: ${reason}`, { cause: err });
			}),
		});
	}
	return name;
}
