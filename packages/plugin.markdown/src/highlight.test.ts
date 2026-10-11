import { describe, expect, test } from 'bun:test';

import * as attrs from '../../bongo/src/utils/attrs';
import { sugarhigh } from './highlight';
import { markdown } from './index';

import type { Loader } from 'bongo';

describe('sugarhigh', () => {
	test('wraps highlighted lines in pre and code', async () => {
		let hl = await sugarhigh();
		let html = hl('let a = 1 < 2;\n', { lang: 'js' });
		expect(html).toStartWith('<pre><code class="language-javascript"><span class="sh__line">');
		expect(html).toEndWith('</span></code></pre>');
		expect(html).toContain('<span class="sh__token--keyword" style="color:var(--sh-keyword)">let</span>');
		expect(html).toContain('<span class="sh__token--sign" style="color:var(--sh-sign)">&lt;</span>');
	});

	test('highlights with the fence language', async () => {
		let hl = await sugarhigh();
		expect(hl('.a { color: red; }\n', { lang: 'scss' })).toContain('<span class="sh__token--property" style="color:var(--sh-property)">color</span>');
		expect(hl('def f(): pass\n', { lang: 'py' })).toStartWith('<pre><code class="language-python">');
	});

	test('drops the empty line after the last newline', async () => {
		let hl = await sugarhigh();
		expect(hl('a\nb\n', { lang: 'ts' })?.match(/"sh__line"/g)).toHaveLength(2);
		expect(hl('a\n\n', { lang: 'ts' })?.match(/"sh__line"/g)).toHaveLength(2);
	});

	test('leaves blocks without a known language to md4x', async () => {
		let hl = await sugarhigh();
		expect(hl('x\n', { lang: '' })).toBeUndefined();
		expect(hl('x\n', { lang: 'elixir' })).toBeUndefined();
	});

	test('renders code blocks through markdown()', async () => {
		let utils: Loader.Utilities = {
			decode: input => new TextDecoder().decode(input),
			frontmatter: () => ({ offset: 0, value: {} }),
			attrs: attrs.parse,
			render: () => '',
		};
		let loader = markdown({ highlighter: sugarhigh() }).$assets!.md!;
		let html = String((await loader('x.md', 'Hi\n\n```ts\nlet a = 1;\n```\n\n```\nplain\n```\n\nafter\n', utils)).content);
		expect(html).toStartWith('<p>Hi</p>\n<pre><code class="language-typescript"><span class="sh__line"><span class="sh__token--keyword" style="color:var(--sh-keyword)">let</span>');
		expect(html).toEndWith('</span></code></pre>\n<pre><code>plain\n</code></pre>\n<p>after</p>\n');
	});
});
