import { join, relative, resolve, sep } from 'node:path';

import * as mime from 'mrmime';

import * as attrs from './attrs';
import * as bundler from './bundler';
import * as fs from './fs';
import * as images from './images';

import type { Argv, Config } from 'bongo';

// `<bongo:script …/>`, `<bongo:script …></bongo:script>`,
// `<bongo:style …/>`, `<bongo:style …></bongo:style>`,
// `<bongo:client …/>`, `<bongo:client …></bongo:client>`,
// `<bongo:asset …/>`, `<bongo:asset …></bongo:asset>`,
// `<bongo:image …/>`, `<bongo:image …></bongo:image>`,
// `<bongo:alternate …/>`, `<bongo:alternate …></bongo:alternate>`.
// Tolerant of inner text (for forward-compat with elements that allow children).
// Quoted attribute values may contain `>` and `/>`, eg `media="(width >= 600px)"`.
const BONGO_TAG = /<bongo:(script|style|client|asset|image|alternate)\b((?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))*?)\s*(?:\/>|>([\s\S]*?)<\/bongo:\1\s*>)/g;

// Path to bongo's bundled browser runtime. Resolves relative to this module:
// — bundled (prod): sibling to packages/bongo/index.js, i.e. ./client.js.
// — source (tests/workspace): packages/bongo/src/utils/tags.ts → ../../client.js.
function resolveBongoClient(): string {
	let bundled = resolve(__dirname, 'client.js');
	if (fs.exists(bundled)) return bundled;
	return resolve(__dirname, '..', '..', 'client.js');
}

const JS_IDENT = /^[a-zA-Z_$][\w$]*$/;

function clientOptions(props: attrs.Attrs): string {
	let pairs: string[] = [];
	for (let key in props) {
		if (key === 'nonce') continue;
		let v = props[key];
		let k = JS_IDENT.test(key) ? key : JSON.stringify(key);
		pairs.push(`${k}: ${v === true ? 'true' : JSON.stringify(v)}`);
	}
	return pairs.length ? `{ ${pairs.join(', ')} }` : '{}';
}

// Attribute parser: name="value" | name='value' | name=bareword | name (boolean).
const ATTR = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

type AttrValue = string | true;
export type Attrs = Record<string, AttrValue>;

/**
 * Read a real HTML element's attributes, like those of an `<img>` in content, as text.
 * `<bongo:*>` elements read typed values with `attrs.parse` instead.
 * @example parseAttrs('src="a.png" alt="" hidden') //=> { src: 'a.png', alt: '', hidden: true }
 */
export function parseAttrs(src: string): Attrs {
	let attrs: Attrs = {};
	let m: RegExpExecArray | null;
	ATTR.lastIndex = 0;
	while ((m = ATTR.exec(src))) {
		let name = m[1];
		let v = m[2] ?? m[3] ?? m[4];
		attrs[name] = v ?? true;
	}
	return attrs;
}

// `<bongo:image>` passes its attributes on to HTML: a list joins with spaces, true is a bare name, false or null drops it.
function forward(props: attrs.Attrs): Attrs {
	let pairs: [string, AttrValue][] = [];
	for (let [name, value] of Object.entries(props)) {
		if (value === false || value == null) continue;
		let text = value === true ? true : Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
		pairs.push([name, text]);
	}
	return Object.fromEntries(pairs);
}

// Attributes are typed (`n=2` is a number), but bongo's own attributes are text or flags.
function str(v: unknown): string | undefined {
	return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function bool(v: unknown): boolean {
	return v === true || v === '' || v === 'true';
}

function off(v: unknown): boolean {
	return v === false || v === 'false';
}

const MODULE_FILE = /\.module\.css$/;

const ATTR_ESCAPE: Record<string, string> = { '&': '&amp;', '"': '&quot;' };

// The attributes that bongo reads itself; any other attribute goes on the element that bongo writes.
const OWN = {
	script: new Set(['src', 'inline', 'async', 'defer', 'format', 'target', 'type']),
	style: new Set(['src', 'inline', 'global', 'rel', 'href']),
	alternate: new Set(['type', 'href', 'rel']),
};

// The alternate types that bongo writes a file for, with the extension of their default href.
const WRITES: Record<string, string> = { 'text/markdown': 'md' };

/** A `<bongo:alternate>` of a page: its type, its href resolved to a URL path (or a full URL elsewhere), and the file that bongo writes, as a path in the output folder. */
export type Alternate = { type: string; href: string; file?: string };

/** The alternates of the page that a scan fills, and whether the page has a Markdown source to copy. */
export type Page = { alternates: Alternate[]; markdown: boolean };

type Format = NonNullable<bundler.BundleConfig['format']>;

function isFormat(value: string): value is Format {
	return value === 'esm' || value === 'cjs' || value === 'iife';
}

function rest(props: attrs.Attrs, own: Set<string>): string {
	let out = '';
	for (let [name, value] of Object.entries(forward(props))) {
		if (own.has(name)) continue;
		out += value === true ? ` ${name}` : ` ${name}="${unescape(value).replace(/[&"]/g, c => ATTR_ESCAPE[c])}"`;
	}
	return out;
}

// `as` for a preload, by mime type; fonts and fetches must be requested in cors mode.
function destination(type: string | undefined): string {
	if (!type) return 'fetch';
	if (type.startsWith('font/')) return 'font';
	if (type.startsWith('image/')) return 'image';
	if (type === 'text/css') return 'style';
	if (type === 'text/javascript') return 'script';
	return 'fetch';
}

// Comments and elements whose text is not markup, which are kept as they are, or an `<img>` and its attributes.
const CONTENT_IMG = /<!--[\s\S]*?-->|<(script|style|template|textarea|picture)\b[\s\S]*?<\/\1\s*>|<img(?=[\s\/>])((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*\/?>/gi;
const NOT_RELATIVE = /^([a-z][a-z\d+.-]*:|\/|#|\?)|</i;
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt));/gi;
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

// An attribute value as the browser reads it: trimmed, with character references decoded.
function unescape(value: string): string {
	return value.trim().replace(ENTITY, (_, dec?: string, hex?: string, name?: string) => {
		if (dec) return String.fromCodePoint(Number(dec));
		if (hex) return String.fromCodePoint(parseInt(hex, 16));
		return ENTITIES[(name ?? '').toLowerCase()];
	});
}

// Resolve a url against the page url, as a browser would, to the file in content/ that it points at.
/**
 * The URL path that a site lives under, from its `$site.url`, such as `/blog/` for `https://example.com/blog`.
 * @example publicPath('https://example.com/blog') //=> '/blog/'
 */
/**
 * The path of a page plus an extension: a folder page gives its route, and the root of the site gives `index`.
 * @example tags.withExtension('/config/', 'md', '/') //=> '/config.md'
 */
export function withExtension(path: string, ext: string, base: string): string {
	let suffix = '.' + ext.replace(/^\./, '');
	let clean = path.replace(/[?#].*$/, '');
	if (!clean.endsWith('/')) return clean.replace(/\.[^/.]*$/, '') + suffix;
	return (clean === base || clean === '/' ? clean + 'index' : clean.slice(0, -1)) + suffix;
}

export function publicPath(siteUrl: string): string {
	try {
		let { pathname } = new URL(siteUrl);
		return pathname.endsWith('/') ? pathname : pathname + '/';
	} catch {
		return '/';
	}
}

// A page image resolves as a browser resolves it; undefined when the URL is outside the site
function inPage(src: string, argv: Required<Argv>, path: string, base: string): string | undefined {
	let { pathname } = new URL(src, 'http://bongo' + path);
	try { pathname = decodeURIComponent(pathname); } catch { /* keep as written */ }
	if (!pathname.startsWith(base)) return;
	return join(argv.content, pathname.substring(base.length - 1));
}

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function preload(href: string, src: string, props: attrs.Attrs): string {
	let known = mime.lookup(src);
	if (known === 'application/octet-stream') known = undefined;
	let type = off(props.type) ? undefined : str(props.type) || known;
	let as = str(props.as) || destination(known);
	let given = props.crossorigin === true || str(props.crossorigin);
	let cors = off(props.crossorigin) ? undefined : given || (as === 'font' || as === 'fetch' || undefined);

	let link: [string, AttrValue | undefined][] = [
		['rel', 'preload'], ['href', href], ['as', as], ['type', type], ['crossorigin', cors],
		['media', str(props.media)], ['fetchpriority', str(props.fetchpriority)],
	];

	let out = '<link';
	for (let [name, value] of link) {
		if (value === undefined) continue;
		out += value === true ? ` ${name}` : ` ${name}="${value.replace(/[&"]/g, c => ATTR_ESCAPE[c])}"`;
	}
	return out + '/>';
}

/**
 * Replace `<bongo:*>` elements in rendered HTML with asset links and placeholders.
 * `from` names where the HTML was rendered, for errors (eg, "content/index.md → layouts/html.hbs").
 * `path` is the page's url path, which page-relative image sources resolve against.
 */
export function scanBongoTags(
	html: string,
	argv: Required<Argv>,
	config: Pick<Required<Config>, '$build' | '$images'> & Partial<Pick<Config, '$site'>>,
	from?: string,
	path = '/',
	page?: Page,
): string {
	let base = publicPath(config.$site?.url ?? '');
	let where = from ? `, rendering ${from}` : '';
	return html.replace(BONGO_TAG, (match, kind: 'script' | 'style' | 'client' | 'asset' | 'image' | 'alternate', rawAttrs: string) => {
		let props = attrs.parse(rawAttrs);

		if (kind === 'alternate') {
			let type = str(props.type);
			if (!type) throw new Error(`${match.trim()} needs a type${where}`);
			type = unescape(type);
			let ext = WRITES[type];
			let given = str(props.href);
			if (given === undefined && !ext) throw new Error(`${match.trim()} needs an href${where}`);
			let href = given === undefined ? withExtension(path, ext, base) : unescape(given);

			let site = new URL(config.$site?.url || 'http://localhost/');
			let url = new URL(href, new URL(path, site));
			let local = url.origin === site.origin;
			let file: string | undefined;
			if (ext && local && url.pathname.startsWith(base)) {
				if (url.pathname.endsWith('/')) throw new Error(`${match.trim()} needs an href that names a file${where}`);
				let name = url.pathname.slice(base.length);
				try {
					file = decodeURIComponent(name);
				} catch {
					file = name;
				}
			}
			// a page that no Markdown file made has nothing to copy, so its layout may still name a copy for every page
			if (file !== undefined && page && !page.markdown) return '';
			let resolved = local ? url.pathname + url.search + url.hash : url.href;
			page?.alternates.push(file === undefined ? { type, href: resolved } : { type, href: resolved, file });

			let escaped = (value: string) => value.replace(/[&"]/g, c => ATTR_ESCAPE[c]);
			return `<link rel="alternate" type="${escaped(type)}" href="${escaped(href)}"${rest(props, OWN.alternate)}/>`;
		}

		if (kind === 'client') {
			// No `src` — bongo wires in its own bundled runtime.
			let entry = resolveBongoClient();
			let placeholder = bundler.register(entry, {
				kind: 'js',
				format: 'esm',
				target: config.$build.target,
				minify: argv.minify || undefined,
			});
			// The runtime adds its aria-live announcer to <body>; a <div> here would end <head> early.
			let nonce = str(props.nonce);
			let attr = nonce === undefined ? '' : ` nonce="${nonce.replace(/[&"]/g, c => ATTR_ESCAPE[c])}"`;
			return `<script type="module"${attr}>import { client } from "${placeholder}"; client(${clientOptions(props)});</script>`;
		}

		let src = str(props.src);
		if (!src) throw new Error(`<bongo:${kind}> missing required "src" attribute`);

		let entry = join(argv.assets, src);
		if (kind === 'image') {
			src = unescape(src);
			// `./a.jpg`, `../a.jpg`, and `/blog/a.jpg` images are in content/; any other path is in assets/
			let root = /^\.{0,2}\//.test(src) ? argv.content : argv.assets;
			let found = root === argv.content ? inPage(src, argv, path, base) : join(argv.assets, src);
			if (!found) throw new Error(`Image "${src}" is outside the site at ${base} for ${match.trim()}${where}`);
			entry = found;
			if (!entry.startsWith(root + sep)) {
				throw new Error(`Image "${src}" is outside ${relative(argv.src, root)}/ for ${match.trim()}${where}`);
			}
		}
		if (!fs.exists(entry)) {
			throw new Error(`Missing "${relative(argv.src, entry)}" for ${match.trim()}${where}`);
		}

		if (kind === 'image') {
			let forwarded = forward(props);
			try {
				var image = images.settings(forwarded, config.$images);
			} catch (err) {
				throw new Error(`${reason(err)} for ${match.trim()}${where}`);
			}
			let placeholder = bundler.register(entry, { kind: 'image', image });
			return `<picture>${images.tag(placeholder, forwarded, config.$images)}</picture>`;
		}

		if (kind === 'asset') {
			let placeholder = bundler.register(entry, { kind: 'file' });
			return bool(props.preload) ? preload(placeholder, src, props) : placeholder;
		}

		if (kind === 'style') {
			// `global` opts out of CSS-modules auto-detect. Default: any *.module.css
			// source gets CSS modules scoping.
			let cssModules = !bool(props.global) && MODULE_FILE.test(src);

			let placeholder = bundler.register(entry, {
				kind: 'css',
				targets: config.$build.target,
				cssModules,
				minify: argv.minify || undefined,
			});

			let extra = rest(props, OWN.style);
			if (bool(props.inline)) {
				return `<style${extra} data-bongo-inline="${placeholder}"></style>`;
			}
			return `<link rel="stylesheet" href="${placeholder}"${extra}/>`;
		}

		// kind === 'script'
		let format = str(props.format) ?? 'esm';
		if (!isFormat(format)) throw new Error(`Unknown format "${format}" for ${match.trim()}${where}; use esm, cjs, or iife`);
		let target = str(props.target) ?? config.$build.target;
		let inline = bool(props.inline);

		// an inline script cannot load chunks by relative path, and cjs and iife cannot load chunks at all
		let split = format === 'esm' && !inline ? undefined : false;
		let placeholder = bundler.register(entry, { kind: 'js', format, target, split, minify: argv.minify || undefined });

		let type = format === 'esm' ? ' type="module"' : '';
		let flags = (bool(props.async) ? ' async' : '') + (format !== 'esm' && bool(props.defer) ? ' defer' : '');
		let extra = rest(props, OWN.script);
		if (inline) return `<script${type}${extra} data-bongo-inline="${placeholder}"${flags}></script>`;
		return `<script${type} src="${placeholder}"${extra}${flags}></script>`;
	});
}

/**
 * Replace each `<img>` in a page's content whose `src` is a relative path with the stand-in that
 * `<bongo:image src="./…">` makes, in its first, preferred format only, so the markup keeps its shape.
 * Images with a `srcset`, inside a `<picture>`, or with an absolute or root-relative url are left as written.
 * @example scanImages('<img src="hero.jpg" alt="">', argv, config, 'content/blog/post.md', '/blog/post/')
 */
export function scanImages(
	html: string,
	argv: Required<Argv>,
	config: Required<Config>,
	from: string,
	path: string,
): string {
	let options = config.$images;
	if (options.content === false) return html;
	let base = publicPath(config.$site.url);

	let settings: images.Settings | undefined;
	return html.replace(CONTENT_IMG, (match, _skipped, raw: string | undefined) => {
		if (raw === undefined) return match;
		let attrs = parseAttrs(raw);
		let src = typeof attrs.src === 'string' ? unescape(attrs.src) : '';
		if (!src || attrs.srcset !== undefined || NOT_RELATIVE.test(src)) return match;
		if (!mime.lookup(src.replace(/[?#].*/, ''))?.startsWith('image/')) return match;

		let file = inPage(src, argv, path, base);
		if (!file) throw new Error(`Image "${src}" is outside the site at ${base} for ${match}, rendering ${from}`);
		if (!file.startsWith(argv.content + sep)) {
			throw new Error(`Image "${src}" is outside content/ for ${match}, rendering ${from}`);
		}
		if (!fs.exists(file)) {
			throw new Error(`Missing "${relative(argv.src, file)}" for ${match}, rendering ${from}`);
		}

		try {
			let formats = images.settings({}, options).formats;
			settings ||= images.settings({ formats: formats[0] }, options);
		} catch (err) {
			throw new Error(`${reason(err)} for ${match}, rendering ${from}`);
		}

		let placeholder = bundler.register(file, { kind: 'image', image: settings });
		return images.tag(placeholder, attrs, options);
	});
}

// ---------------------------------------------------------------------------
// transition:name / transition:animate build-time attribute rewrite
// ---------------------------------------------------------------------------

// Matches transition:name="VALUE" or transition:animate="VALUE" (double or single quotes).
const TRANSITION_ATTR = /\btransition:(name|animate)=(?:"([^"]*)"|'([^']*)')/g;

// Matches a tag opening up to (and not including) the closing > or />.
// Captures: [1] tag name, [2] attrs string, [3] '/' if self-closing.
const OPEN_TAG = /<([\w-]+)(\s[^>]*?)?\s*(\/?)>/g;

// Simple FNV-1a 32-bit hash — used to generate auto names.
function fnv32a(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

type TransitionPair = { name: string; animate: string | null };

function parseTransitionAttrs(src: string): TransitionPair | null {
	let name: string | null = null;
	let animate: string | null = null;
	let m: RegExpExecArray | null;
	TRANSITION_ATTR.lastIndex = 0;
	while ((m = TRANSITION_ATTR.exec(src))) {
		let val = m[2] ?? m[3];
		if (m[1] === 'name') name = val;
		else if (m[1] === 'animate') animate = val;
	}
	if (name === null && animate === null) return null;
	return { name: name ?? '', animate };
}

function stripTransitionAttrs(src: string): string {
	return src.replace(TRANSITION_ATTR, '').replace(/\s{2,}/g, ' ').trim();
}

function mergeStyle(existing: string | null, extra: string): string {
	let base = existing?.trim() ?? '';
	if (!base) return extra;
	// Ensure trailing semicolon before merging.
	if (!base.endsWith(';')) base += ';';
	return `${base} ${extra}`;
}

/**
 * Rewrites `transition:name="..."` and `transition:animate="..."` attributes
 * on ordinary HTML elements at build time.
 *
 * - `transition:name="NAME"` → inline `view-transition-name: NAME` style.
 * - `transition:animate="KEYFRAME"` → also injects a `::view-transition-{old,new}(NAME)`
 *   CSS rule into a `<style data-bongo-transitions>` block appended to `<head>`.
 *   When `transition:animate` appears without `transition:name`, an auto name
 *   (`bongo-auto-<hash>`) is generated.
 */
export function rewriteTransitionAttrs(html: string): string {
	let cssRules: string[] = [];

	// Reset regex state (stateful via lastIndex).
	OPEN_TAG.lastIndex = 0;

	let result = html.replace(OPEN_TAG, (fullMatch, _tagName: string, rawAttrs: string | undefined, selfClose: string) => {
		if (!rawAttrs) return fullMatch;

		let pair = parseTransitionAttrs(rawAttrs);
		if (!pair) return fullMatch;

		let { name, animate } = pair;

		// Resolve the view-transition name: explicit or auto-generated.
		let vtName = name || `bongo-auto-${fnv32a(fullMatch)}`;

		// Strip transition:* attrs from the raw attrs string.
		let cleanAttrs = stripTransitionAttrs(rawAttrs);

		// Find existing style="" value (if any) and merge.
		let styleMatch = cleanAttrs.match(/\bstyle=(?:"([^"]*)"|'([^']*)')/);
		let existingStyle = styleMatch ? (styleMatch[1] ?? styleMatch[2] ?? null) : null;
		let newStyle = mergeStyle(existingStyle, `view-transition-name: ${vtName}`);

		// Replace (or add) style attr in cleanAttrs.
		let attrsWithStyle: string;
		if (styleMatch) {
			attrsWithStyle = cleanAttrs.replace(/\bstyle=(?:"[^"]*"|'[^']*')/, `style="${newStyle}"`);
		} else {
			attrsWithStyle = cleanAttrs ? `${cleanAttrs} style="${newStyle}"` : `style="${newStyle}"`;
		}

		// Collect CSS rule for animate.
		if (animate) {
			cssRules.push(
				`::view-transition-old(${vtName}),::view-transition-new(${vtName}){animation-name:${animate}}`,
			);
		}

		let rebuiltTag = `<${_tagName} ${attrsWithStyle}${selfClose ? ' /' : ''}>`;
		return rebuiltTag;
	});

	// Inject <style data-bongo-transitions> into <head> if any animate rules were collected.
	if (cssRules.length > 0) {
		let block = `<style data-bongo-transitions>${cssRules.join('')}</style>`;
		// Prefer injecting just before </head>; fall back to prepending if no </head>.
		if (result.includes('</head>')) {
			result = result.replace('</head>', `${block}</head>`);
		} else {
			result = block + result;
		}
	}

	return result;
}
