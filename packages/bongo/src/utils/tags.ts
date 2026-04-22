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
