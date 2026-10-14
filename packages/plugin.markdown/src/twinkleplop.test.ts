import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { language as bash } from '@twinkleplop/bash';
import { language as typescript } from '@twinkleplop/typescript';
import { renderToHtml } from 'md4x';

import { build } from '../../bongo/src/build';
import { twinkleplop } from './twinkleplop';

import type { Options } from './twinkleplop';

async function render(src: string, options: Options): Promise<string> {
	return renderToHtml(src, { highlighter: await twinkleplop(options) });
}

function fence(lang: string, code: string): string {
	return '```' + lang + '\n' + code + '\n```\n';
}

describe('twinkleplop', () => {
	test('highlights a registered language', async () => {
		let html = await render(fence('ts', 'const x = 1;'), { languages: { ts: typescript() } });
		expect(html).toStartWith('<pre class="twinkleplop language-ts" data-language="ts"><code><span class="l">');
		expect(html).toContain('<span class="tok keyword">const</span>');
	});

	test('resolves common aliases to a registered language', async () => {
		let options: Options = { languages: { typescript: typescript(), sh: bash() } };
		for (let lang of ['typescript', 'ts', 'mts', 'cts']) {
			let html = await render(fence(lang, 'const x = 1;'), options);
			expect(html).toContain(`<pre class="twinkleplop language-${lang}" data-language="${lang}">`);
			expect(html).toContain('<span class="tok keyword">const</span>');
		}
		for (let lang of ['sh', 'bash', 'shell', 'zsh']) {
			let html = await render(fence(lang, 'echo $HOME'), options);
			expect(html).toContain(`data-language="${lang}"`);
			expect(html).toContain('<span class="tok builtin">echo</span> <span class="tok variable">$HOME</span>');
		}
	});

	test('resolves hbs fences to a registered handlebars language', async () => {
		let options: Options = { languages: { handlebars: code => `<pre>${code}</pre>` } };
		expect(await render(fence('hbs', '{{ x }}'), options)).toBe('<pre>{{ x }}</pre>');
		expect(await render(fence('handlebars', '{{ x }}'), options)).toBe('<pre>{{ x }}</pre>');
	});

	test('follows aliases you register', async () => {
		let options: Options = { languages: { ts: typescript(), js: 'ts' } };
		for (let lang of ['js', 'javascript', 'mjs']) {
			let html = await render(fence(lang, 'const x = 1;'), options);
			expect(html).toContain(`data-language="${lang}"`);
			expect(html).toContain('<span class="tok keyword">const</span>');
		}
	});

	test('prefers your own entries over built-in aliases', async () => {
		let options: Options = { languages: { typescript: typescript(), mts: code => `<pre>${code.length}</pre>` } };
		expect(await render(fence('mts', 'const x = 1;'), options)).toBe('<pre>12</pre>');
		expect(await render(fence('cts', 'const x = 1;'), options)).toContain('<span class="tok keyword">const</span>');
	});

	test('renders unknown languages as escaped plain text', async () => {
		let html = await render(fence('nope', '<b>&</b>'), { languages: { ts: typescript() } });
		expect(html).toBe('<pre class="twinkleplop language-nope" data-language="nope"><code><span class="l">&lt;b&gt;&amp;&lt;/b&gt;</span></code></pre>');
	});

	test('does not alias a language you did not register', async () => {
		let html = await render(fence('js', 'const x = 1;'), { languages: { ts: typescript() } });
		expect(html).toBe('<pre class="twinkleplop language-js" data-language="js"><code><span class="l">const x = 1;</span></code></pre>');
	});

	test('throws on unknown languages when asked to', async () => {
		let highlighter = await twinkleplop({ languages: { ts: typescript() }, on_unknown_language: 'throw' });
		expect(() => renderToHtml(fence('nope', 'x'), { highlighter })).toThrow('unknown fence language "nope"');
	});

	test('leaves code without a language to md4x', async () => {
		let html = await render(fence('', '<b>') + '\n    indented\n', { languages: { ts: typescript() } });
		expect(html).toBe('<pre><code>&lt;b&gt;\n</code></pre>\n<pre><code>indented\n</code></pre>\n');
	});

	test('highlights code without a language as default_language', async () => {
		let html = await render(fence('', 'const x = 1;'), { languages: { typescript: typescript() }, default_language: 'ts' });
		expect(html).toContain('<pre class="twinkleplop language-ts" data-language="ts">');
		expect(html).toContain('<span class="tok keyword">const</span>');
	});

	test('escapes code', async () => {
		let html = await render(fence('ts', 'let s = "</code></pre><script>&";'), { languages: { ts: typescript() } });
		expect(html).toContain('<span class="tok string">&quot;&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;&amp;&quot;</span>');
		expect(html).not.toContain('<script>');
	});

	test('passes options through', async () => {
		let html = await render(fence('ts', 'a\nb'), {
			languages: { ts: typescript() },
			line_numbers: { start: 3 },
			render: { class_name: 'code', attributes: { 'data-x': 'y' }, whitespace: 'all' },
		});
		expect(html).toBe([
			'<pre class="code language-ts" data-x="y" data-language="ts"><code>',
			'<span class="l"><span class="ln">3</span><span class="tok identifier">a</span></span>\n',
			'<span class="l"><span class="ln">4</span><span class="tok identifier">b</span></span>',
			'</code></pre>',
		].join(''));
	});

	test('reads highlighted lines and the filename from the fence', async () => {
		let html = await render(fence('ts {1,3} [a <b>.ts]', 'a\nb\nc'), { languages: { ts: typescript() } });
		expect(html).toBe([
			'<figure class="twinkleplop-block" data-language="ts">\n',
			'<figcaption class="twinkleplop-title">a &lt;b&gt;.ts</figcaption>\n',
			'<pre class="twinkleplop language-ts has-highlight" data-language="ts"><code>',
			'<span class="l highlight"><span class="tok identifier">a</span></span>\n',
			'<span class="l"><span class="tok identifier">b</span></span>\n',
			'<span class="l highlight"><span class="tok identifier">c</span></span>',
			'</code></pre>\n',
			'</figure>',
		].join(''));
	});

	test('reads line number flags after the language', async () => {
		let options: Options = { languages: { ts: typescript() }, line_numbers: true };
		let html = await render(fence('ts:line-numbers=5', 'a'), options);
		expect(html).toContain('<pre class="twinkleplop language-ts" data-language="ts">');
		expect(html).toContain('<span class="ln">5</span>');
		html = await render(fence('ts:no-line-numbers', 'a'), options);
		expect(html).toContain('data-language="ts"');
		expect(html).not.toContain('class="ln"');
	});
});

describe('twinkleplop: site build', () => {
	test('highlights markdown and bundles a theme', async () => {
		let root = await mkdtemp(join(tmpdir(), 'bongo-twinkleplop-'));
		let files: Record<string, string> = {
			'bongo.config.ts': [
				`import { language as typescript } from '@twinkleplop/typescript';`,
				`import { markdown } from ${JSON.stringify(join(import.meta.dirname, 'index'))};`,
				`import { twinkleplop } from ${JSON.stringify(join(import.meta.dirname, 'twinkleplop'))};`,
				`export default {`,
				`	$site: { url: 'https://example.com/', title: 'T', lang: 'en' },`,
				`	plugins: [markdown({ highlighter: twinkleplop({ languages: { typescript: typescript() } }) })],`,
				`};`,
			].join('\n'),
			'layouts/html.hbs': '<bongo:style src="app.css"></bongo:style>\n<main>{{{ $page.content }}}</main>',
			'assets/app.css': '@import "@twinkleplop/theme-github";\n',
			'content/index.md': '---\ntitle: Home\n---\n\n' + fence('ts', 'const x = 1;') + '\n' + fence('txt', 'a < b'),
		};

		try {
			await symlink(join(import.meta.dirname, '../node_modules'), join(root, 'node_modules'));
			for (let [rel, text] of Object.entries(files)) {
				await mkdir(join(root, rel, '..'), { recursive: true });
				await writeFile(join(root, rel), text);
			}

			await build({ cwd: root });

			let out = join(root, 'public');
			let html = await readFile(join(out, 'index.html'), 'utf8');
			expect(html).toContain('<pre class="twinkleplop language-ts" data-language="ts"><code><span class="l"><span class="tok keyword">const</span>');
			expect(html).toContain('<pre class="twinkleplop language-txt" data-language="txt"><code><span class="l">a &lt; b</span></code></pre>');

			let css = (await readdir(out)).find(file => /^app\.[\w-]+\.css$/.test(file));
			expect(html).toContain(`<link rel="stylesheet" href="/${css}"/>`);
			let theme = await readFile(join(out, String(css)), 'utf8');
			expect(theme).toContain('--twp-keyword');
			expect(theme).toContain('.twinkleplop .keyword');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
