import { join } from 'node:path';
import * as bundler from './bundler';
import * as fs from './fs';

import type { Argv, Config } from 'bongo';

// `<bongo:script …/>`, `<bongo:script …></bongo:script>`,
// `<bongo:style …/>`, `<bongo:style …></bongo:style>`.
// Tolerant of inner text (for forward-compat with elements that allow children).
const BONGO_TAG = /<bongo:(script|style)\b([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/bongo:\1\s*>)/g;

// Attribute parser: name="value" | name='value' | name=bareword | name (boolean).
const ATTR = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

type AttrValue = string | true;
type Attrs = Record<string, AttrValue>;

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

export function scanBongoTags(
	html: string,
	argv: Required<Argv>,
	config: Required<Config>,
): string {
	return html.replace(BONGO_TAG, (_match, kind: 'script' | 'style', rawAttrs: string) => {
		let attrs = parseAttrs(rawAttrs);
		let src = str(attrs.src);
		if (!src) throw new Error(`<bongo:${kind}> missing required "src" attribute`);

		let entry = join(argv.assets, src);
		fs.assert(entry, `assets/${src}`);

		if (kind === 'style') {
			// `global` opts out of CSS-modules auto-detect. Default: any *.module.css
			// source gets CSS modules scoping.
			let cssModules = !bool(attrs.global) && MODULE_FILE.test(src);

			let placeholder = bundler.register(entry, {
				kind: 'css',
				targets: config.$build.target,
				cssModules,
			});

			if (bool(attrs.inline)) {
				return `<style data-bongo-inline="${placeholder}"></style>`;
			}
			return `<link rel="stylesheet" href="${placeholder}"/>`;
		}

		// kind === 'script'
		let format: 'esm' | 'cjs' = str(attrs.format) === 'cjs' ? 'cjs' : 'esm';
		let target = str(attrs.target) ?? config.$build.target;

		let placeholder = bundler.register(entry, { kind: 'js', format, target });

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
