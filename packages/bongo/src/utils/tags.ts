import { join, relative, resolve } from 'node:path';
import * as mime from 'mrmime';
import * as bundler from './bundler';
import * as fs from './fs';
import * as images from './images';

import type { Argv, Config } from 'bongo';

// `<bongo:script …/>`, `<bongo:script …></bongo:script>`,
// `<bongo:style …/>`, `<bongo:style …></bongo:style>`,
// `<bongo:client …/>`, `<bongo:client …></bongo:client>`,
// `<bongo:asset …/>`, `<bongo:asset …></bongo:asset>`,
// `<bongo:image …/>`, `<bongo:image …></bongo:image>`.
// Tolerant of inner text (for forward-compat with elements that allow children).
// Quoted attribute values may contain `>` and `/>`, eg `media="(width >= 600px)"`.
const BONGO_TAG = /<bongo:(script|style|client|asset|image)\b((?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))*?)\s*(?:\/>|>([\s\S]*?)<\/bongo:\1\s*>)/g;

// Path to bongo's bundled browser runtime. Resolves relative to this module:
// — bundled (prod): sibling to packages/bongo/index.js, i.e. ./client.js.
// — source (tests/workspace): packages/bongo/src/utils/tags.ts → ../../client.js.
function resolveBongoClient(): string {
	let bundled = resolve(__dirname, 'client.js');
	if (fs.exists(bundled)) return bundled;
	return resolve(__dirname, '..', '..', 'client.js');
}

const JS_IDENT = /^[a-zA-Z_$][\w$]*$/;

function clientOptions(attrs: Attrs): string {
	let pairs: string[] = [];
	for (let key in attrs) {
		let v = attrs[key];
		let k = JS_IDENT.test(key) ? key : JSON.stringify(key);
		pairs.push(`${k}: ${v === true ? 'true' : JSON.stringify(v)}`);
	}
	return pairs.length ? `{ ${pairs.join(', ')} }` : '{}';
}

// Attribute parser: name="value" | name='value' | name=bareword | name (boolean).
const ATTR = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

type AttrValue = string | true;
export type Attrs = Record<string, AttrValue>;

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

function str(v: AttrValue | undefined): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function bool(v: AttrValue | undefined): boolean {
	return v === true || v === '' || v === 'true';
}

const MODULE_FILE = /\.module\.css$/;

const ATTR_ESCAPE: Record<string, string> = { '&': '&amp;', '"': '&quot;' };

// `as` for a preload, by mime type; fonts and fetches must be requested in cors mode.
function destination(type: string | undefined): string {
	if (!type) return 'fetch';
	if (type.startsWith('font/')) return 'font';
	if (type.startsWith('image/')) return 'image';
	if (type === 'text/css') return 'style';
	if (type === 'text/javascript') return 'script';
	return 'fetch';
}

// `img/a.jpg` sits in assets/; `./a.jpg`, `../a.jpg`, and `/blog/a.jpg` resolve against the page url, in content/.
function locate(src: string, argv: Required<Argv>, path: string): string {
	if (!/^\.{0,2}\//.test(src)) return join(argv.assets, src);
	let { pathname } = new URL(src, 'http://bongo' + path);
	try { pathname = decodeURIComponent(pathname); } catch { /* keep as written */ }
	return join(argv.content, pathname);
}

function preload(href: string, src: string, attrs: Attrs): string {
	let off = (v: AttrValue | undefined) => v === 'false';
	let known = mime.lookup(src);
	if (known === 'application/octet-stream') known = undefined;
	let type = off(attrs.type) ? undefined : str(attrs.type) || known;
	let as = str(attrs.as) || destination(known);
	let cors = off(attrs.crossorigin) ? undefined : attrs.crossorigin ?? (as === 'font' || as === 'fetch' || undefined);

	let link: [string, AttrValue | undefined][] = [
		['rel', 'preload'], ['href', href], ['as', as], ['type', type], ['crossorigin', cors],
		['media', str(attrs.media)], ['fetchpriority', str(attrs.fetchpriority)],
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
	config: Required<Config>,
	from?: string,
	path = '/',
): string {
	let where = from ? `, rendering ${from}` : '';
	return html.replace(BONGO_TAG, (match, kind: 'script' | 'style' | 'client' | 'asset' | 'image', rawAttrs: string) => {
		let attrs = parseAttrs(rawAttrs);

		if (kind === 'client') {
			// No `src` — bongo wires in its own bundled runtime.
			let entry = resolveBongoClient();
			let placeholder = bundler.register(entry, {
				kind: 'js',
				format: 'esm',
				target: config.$build.target,
				minify: argv.minify || undefined,
			});
			// Always emit the aria-live announcer at this location so it is
			// parsed before the bootstrap script runs. The runtime looks it up
			// by id and updates its text on every navigation.
			let announcer = '<div id="bongo:live" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0"></div>';
			return `${announcer}<script type="module">import { client } from "${placeholder}"; client(${clientOptions(attrs)});</script>`;
		}

		let src = str(attrs.src);
		if (!src) throw new Error(`<bongo:${kind}> missing required "src" attribute`);

		let entry = kind === 'image' ? locate(src, argv, path) : join(argv.assets, src);
		if (!fs.exists(entry)) {
			throw new Error(`Missing "${relative(argv.src, entry)}" for ${match.trim()}${where}`);
		}

		if (kind === 'image') {
			try {
				var image = images.settings(attrs, config.$images);
			} catch (err) {
				throw new Error(`${err instanceof Error ? err.message : err} for ${match.trim()}${where}`);
			}
			let placeholder = bundler.register(entry, { kind: 'image', image });
			return `<picture>${images.tag(placeholder, attrs, config.$images)}</picture>`;
		}

		if (kind === 'asset') {
			let placeholder = bundler.register(entry, { kind: 'file' });
			return bool(attrs.preload) ? preload(placeholder, src, attrs) : placeholder;
		}

		if (kind === 'style') {
			// `global` opts out of CSS-modules auto-detect. Default: any *.module.css
			// source gets CSS modules scoping.
			let cssModules = !bool(attrs.global) && MODULE_FILE.test(src);

			let placeholder = bundler.register(entry, {
				kind: 'css',
				targets: config.$build.target,
				cssModules,
				minify: argv.minify || undefined,
			});

			if (bool(attrs.inline)) {
				return `<style data-bongo-inline="${placeholder}"></style>`;
			}
			return `<link rel="stylesheet" href="${placeholder}"/>`;
		}

		// kind === 'script'
		let format: 'esm' | 'cjs' = str(attrs.format) === 'cjs' ? 'cjs' : 'esm';
		let target = str(attrs.target) ?? config.$build.target;

		let placeholder = bundler.register(entry, { kind: 'js', format, target, minify: argv.minify || undefined });

		if (bool(attrs.inline)) {
			return `<script data-bongo-inline="${placeholder}"></script>`;
		}

		let extras = '';
		if (bool(attrs.async)) extras += ' async';
		if (format !== 'cjs') extras += ' type="module"';
		else if (bool(attrs.defer)) extras += ' defer';
		return `<script${extras} src="${placeholder}"></script>`;
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
