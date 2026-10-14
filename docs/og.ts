import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import type { SatoriOptions } from 'satori';

type Style = Record<string, string | number>;

type Card = {
	slug: string;
	title: string;
	summary: string;
	group: string;
};

type Element = {
	type: string;
	props: {
		style?: Style;
		src?: string;
		children?: Element | string | (Element | string)[];
	};
};

const ROOT = import.meta.dirname;
const DOCS = join(ROOT, 'content/docs');
const OUT = join(ROOT, 'assets/og');

const INK = '#141414';
const GROUPS: Record<string, string> = {
	Start: '#FFD23F',
	Guides: '#FF5A36',
	Runtime: '#B8A6FF',
	Reference: '#7EE0B5',
	Plugins: '#7CC4FF',
};

function font(pkg: string, file: string): Buffer {
	let dir = dirname(fileURLToPath(import.meta.resolve(`${pkg}/LICENSE`)));
	return readFileSync(join(dir, 'files', file));
}

function svg(file: string): string {
	let text = readFileSync(join(ROOT, 'partials', file), 'utf8').replace(/ class="[^"]*"/g, '').replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"');
	return 'data:image/svg+xml;base64,' + Buffer.from(text).toString('base64');
}

function h(type: string, style: Style, ...children: (Element | string)[]): Element {
	return { type, props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children: children.length === 1 ? children[0] : children } };
}

function img(src: string, style: Style): Element {
	return { type: 'img', props: { src, style } };
}

function grid(): Element {
	let pattern = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><pattern id="d" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.7" fill="#141414" fill-opacity=".18"/></pattern></defs><rect width="1200" height="630" fill="url(#d)"/></svg>';
	return img('data:image/svg+xml;base64,' + Buffer.from(pattern).toString('base64'), { position: 'absolute', left: 0, top: 0, width: 1200, height: 630 });
}

function clamp(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, text.lastIndexOf(' ', max)).replace(/[,.;:]$/, '') + '…';
}

function frontmatter(text: string): Record<string, string> {
	let block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
	let out: Record<string, string> = {};
	for (let line of block.split(/\r?\n/)) {
		let match = /^(\w+):\s*(.*)$/.exec(line);
		if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
	}
	return out;
}

const WORDMARK = svg('wordmark.hbs');
const MARK = svg('mark.hbs');

function card(page: Card): Element {
	let path = page.slug === 'index' ? 'docs/' : `docs/${page.slug}/`;
	return h('div', { width: 1200, height: 630, position: 'relative', flexDirection: 'column', padding: '70px 80px', background: GROUPS[page.group] ?? GROUPS.Start },
		grid(),
		h('div', { justifyContent: 'space-between', alignItems: 'center' },
			img(WORDMARK, { width: 78 * 4853 / 1609, height: 78 }),
			h('div', { padding: '12px 20px', borderRadius: 999, background: INK, color: '#FFFDF7', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 24, letterSpacing: 3, textTransform: 'uppercase' }, page.group)),
		h('div', { marginTop: 'auto', maxWidth: 1040, color: INK, fontFamily: 'Unbounded', fontWeight: 800, fontSize: page.title.length > 12 ? 96 : 118, letterSpacing: page.title.length > 12 ? -4 : -5, lineHeight: 1.02 }, page.title),
		h('div', { marginTop: 22, maxWidth: 960, color: '#141414CC', fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 28, lineHeight: 1.4 }, clamp(page.summary, 120)),
		h('div', { marginTop: 30, justifyContent: 'space-between', alignItems: 'center' },
			h('div', { color: INK, fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 24 }, `bongo.build/${path}`),
			img(MARK, { width: 64, height: 64 })));
}

let fonts: SatoriOptions['fonts'] = [
	{ name: 'Unbounded', data: font('@fontsource/unbounded', 'unbounded-latin-800-normal.woff'), weight: 800 },
	{ name: 'Space Grotesk', data: font('@fontsource/space-grotesk', 'space-grotesk-latin-500-normal.woff'), weight: 500 },
	{ name: 'Space Grotesk', data: font('@fontsource/space-grotesk', 'space-grotesk-latin-700-normal.woff'), weight: 700 },
	{ name: 'JetBrains Mono', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'), weight: 700 },
];

mkdirSync(OUT, { recursive: true });

for (let file of readdirSync(DOCS).filter(name => name.endsWith('.md'))) {
	let meta = frontmatter(readFileSync(join(DOCS, file), 'utf8'));
	let page: Card = { slug: file.slice(0, -3), title: meta.title ?? '', summary: meta.summary ?? '', group: meta.group ?? 'Start' };
	let markup = await satori(card(page), { width: 1200, height: 630, fonts });
	writeFileSync(join(OUT, `docs-${page.slug}.png`), new Resvg(markup, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
}
