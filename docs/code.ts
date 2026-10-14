import { language as bash } from '@twinkleplop/bash';
import { language as css } from '@twinkleplop/css';
import { language as html } from '@twinkleplop/html';
import { language as javascript } from '@twinkleplop/javascript';
import { language as json } from '@twinkleplop/json';
import { language as markdown } from '@twinkleplop/markdown';
import { language as typescript } from '@twinkleplop/typescript';
import { language as yaml } from '@twinkleplop/yaml';

import { language as handlebars } from '@twinkleplop/html';

import type { Build } from 'bongo';

const NAMES: Record<string, string> = {
	bash: 'Shell',
	css: 'CSS',
	handlebars: 'Handlebars',
	hbs: 'Handlebars',
	html: 'HTML',
	javascript: 'JavaScript',
	js: 'JavaScript',
	json: 'JSON',
	markdown: 'Markdown',
	md: 'Markdown',
	sh: 'Shell',
	ts: 'TypeScript',
	typescript: 'TypeScript',
	xml: 'XML',
	yaml: 'YAML',
	yml: 'YAML',
};

const BLOCK = /<figure class="twinkleplop-block"[^>]*>\s*<figcaption class="twinkleplop-title">([\s\S]*?)<\/figcaption>\s*(<pre[^>]*data-language="([^"]*)"[\s\S]*?<\/pre>)\s*(?:<figcaption class="twinkleplop-caption">[\s\S]*?<\/figcaption>\s*)?<\/figure>|(<pre class="twinkleplop language-[^"]*" data-language="([^"]*)"[\s\S]*?<\/pre>)/g;

const HIGHLIGHTERS: Record<string, (code: string) => string> = {
	bash: bash(),
	css: css(),
	handlebars: handlebars(),
	html: html(),
	javascript: javascript(),
	json: json(),
	markdown: markdown(),
	typescript: typescript(),
	yaml: yaml(),
};

const ALIASES: Record<string, string> = { hbs: 'handlebars', md: 'markdown', sh: 'bash', ts: 'typescript' };

/**
 * The twinkleplop highlighters for each fence language the docs use.
 * @example markdown({ highlighter: twinkleplop({ languages }) })
 */
export const languages = { ...HIGHLIGHTERS, xml: 'html' };

/**
 * Highlight source code as a bare `<pre class="twinkleplop">` block.
 * @example highlight('let a = 1;', 'ts')
 */
export function highlight(code: string, lang: string): string {
	let fn = HIGHLIGHTERS[ALIASES[lang] ?? lang];
	if (!fn) throw new Error(`No highlighter for "${lang}"`);
	return fn(code);
}

/**
 * Give each code block a title bar with its file name or language and a copy button, frame plain blocks, and let wide tables scroll.
 * @example $hooks: { transform }
 */
export const transform: Build.Transform = (text, ctx) => {
	if (ctx.kind !== 'page') return text;
	return text
		.replace(BLOCK, (_, title: string | undefined, titled: string, lang: string, bare: string, bareLang: string) => {
			let label = title ? `<span>${title}</span><span class="lang">${lang}</span>` : `<span>${NAMES[bareLang] ?? bareLang}</span>`;
			return `<figure class="code"><div class="bar">${label}<button class="copy" type="button" data-copy-code>Copy</button></div>${title ? titled : bare}</figure>`;
		})
		.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, body: string) => `<figure class="code"><pre class="twinkleplop"><code>${body}</code></pre></figure>`)
		.replace(/<table>[\s\S]*?<\/table>/g, table => `<div class="tbl">${table}</div>`);
};
