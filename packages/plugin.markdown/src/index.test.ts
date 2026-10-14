import { describe, expect, test } from 'bun:test';

import * as attrs from '../../bongo/src/utils/attrs';
import { markdown } from './index';

import type { Loader } from 'bongo';

function setup() {
	let calls: [string, Record<string, unknown>][] = [];
	let utils: Loader.Utilities = {
		decode: input => new TextDecoder().decode(input),
		frontmatter: () => ({ offset: 0, value: {} }),
		attrs: attrs.parse,
		render(name: string, args: Record<string, unknown>) {
			calls.push([name, args]);
			return `<i data-partial="${name}"></i>`;
		},
	};
	let loader = markdown().$assets!.md!;
	let run = async (src: string) => String((await loader('x.md', src, utils)).content);
	return { calls, run, utils };
}

describe('partials', () => {
	test('expands tags in prose', async () => {
		let { calls, run } = setup();
		let html = await run('Hello\n\n<bongo:greet name="world" />\n');
		expect(calls).toEqual([['greet', { name: 'world' }]]);
		expect(html).toContain('<i data-partial="greet"></i>');
	});

	test('expands self-closing tags without attributes', async () => {
		let { calls, run } = setup();
		await run('<bongo:hr />\n\ntext\n\n<bongo:greet name="x" />\n');
		expect(calls).toEqual([['hr', {}], ['greet', { name: 'x' }]]);
	});

	test('allows > inside quoted attributes', async () => {
		let { calls, run } = setup();
		await run('<bongo:greet title="a > b" />\n');
		expect(calls).toEqual([['greet', { title: 'a > b' }]]);
	});

	test('parses attribute values as data', async () => {
		let { calls, run } = setup();
		await run('<bongo:greet count=2 on=true none=null opts={a: 1, b: [x, "y"]} list=[1, two] name=world featured />\n');
		expect(calls).toEqual([['greet', {
			count: 2, on: true, none: null, opts: { a: 1, b: ['x', 'y'] }, list: [1, 'two'], name: 'world', featured: true,
		}]]);
	});

	test('never runs attribute values as code', async () => {
		let { calls, run } = setup();
		let flag = globalThis as { __bongo_md_ran?: boolean };
		await run('<bongo:greet a=(globalThis.__bongo_md_ran=true) b={x: (globalThis.__bongo_md_ran=true)} c=`${globalThis.__bongo_md_ran=true}` />\n');
		expect(flag.__bongo_md_ran).toBeUndefined();
		expect(calls).toEqual([['greet', {
			a: '(globalThis.__bongo_md_ran=true)',
			b: { x: '(globalThis.__bongo_md_ran=true)' },
			c: '${globalThis.__bongo_md_ran=true}',
		}]]);
	});

	test('passes slot content', async () => {
		let { calls, run } = setup();
		await run('<bongo:card>Hello *there*</bongo:card>\n');
		expect(calls).toEqual([['card', { $slot: 'Hello <em>there</em>' }]]);
	});

	test('keeps backtick-quoted attributes working', async () => {
		let { calls, run } = setup();
		await run('<bongo:greet name=`world` />\n');
		expect(calls).toEqual([['greet', { name: 'world' }]]);
	});

	test('leaves fenced code alone', async () => {
		let { calls, run } = setup();
		let html = await run('```html\n<bongo:style src="app.css"></bongo:style>\n<bongo:client />\n```\n');
		expect(calls).toEqual([]);
		expect(html).toContain('&lt;bongo:style src=&quot;app.css&quot;&gt;&lt;/bongo:style&gt;');
		expect(html).toContain('&lt;bongo:client /&gt;');
	});

	test('leaves tilde fences and longer fences alone', async () => {
		let { calls, run } = setup();
		let html = await run('~~~\n<bongo:a />\n~~~\n\n````md\n```html\n<bongo:b />\n```\n````\n');
		expect(calls).toEqual([]);
		expect(html).toContain('&lt;bongo:a /&gt;');
		expect(html).toContain('&lt;bongo:b /&gt;');
	});

	test('leaves inline code alone', async () => {
		let { calls, run } = setup();
		let html = await run('Use `<bongo:script src="main.ts" />` or ``<bongo:client />`` here.\n');
		expect(calls).toEqual([]);
		expect(html).toContain('<code>&lt;bongo:script src=&quot;main.ts&quot; /&gt;</code>');
		expect(html).toContain('<code>&lt;bongo:client /&gt;</code>');
	});

	test('expands prose tags next to code', async () => {
		let { calls, run } = setup();
		await run('`<bongo:a />`\n\n<bongo:greet />\n\n```\n<bongo:b />\n```\n\n<bongo:greet name="again" />\n');
		expect(calls.map(c => c[0])).toEqual(['greet', 'greet']);
	});

	test('keeps code inside a slot as code', async () => {
		let { calls, run } = setup();
		await run('<bongo:card>\n\n```html\n<bongo:style src="x.css" />\n```\n\n</bongo:card>\n');
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe('card');
		expect(String(calls[0][1].$slot)).toContain('&lt;bongo:style src=&quot;x.css&quot; /&gt;');
	});

	test('keeps partial output as html, never re-parsed as markdown', async () => {
		let utils: Loader.Utilities = {
			decode: input => new TextDecoder().decode(input),
			frontmatter: () => ({ offset: 0, value: {} }),
			attrs: attrs.parse,
			render: () => '<p class="meta">\n\t<time>x</time>\n\n\t<span class="tags">*a*</span>\n</p>',
		};
		let loader = markdown().$assets!.md!;
		let html = String((await loader('x.md', 'Intro *here*.\n\n<bongo:meta />\n\nInline <bongo:meta /> too.\n', utils)).content);
		expect(html).toContain('<p>Intro <em>here</em>.</p>\n<p class="meta">\n\t<time>x</time>\n\n\t<span class="tags">*a*</span>\n</p>');
		expect(html).toContain('<p>Inline <p class="meta">');
		expect(html).not.toContain('<pre>');
		expect(html).not.toContain('<p><p');
	});

	test('passes asset tags emitted by partials through untouched', async () => {
		let utils: Loader.Utilities = {
			decode: input => new TextDecoder().decode(input),
			frontmatter: () => ({ offset: 0, value: {} }),
			attrs: attrs.parse,
			render: () => '<bongo:script src="widget.ts"></bongo:script>',
		};
		let loader = markdown().$assets!.md!;
		let html = String((await loader('x.md', '<bongo:widget />\n', utils)).content);
		expect(html).toBe('<bongo:script src="widget.ts"></bongo:script>');
	});

	test('passes bongo built-in elements through for bongo to handle', async () => {
		let { calls, run } = setup();
		let html = await run([
			'<bongo:asset preload src="fonts/f.woff2" />',
			'',
			'A logo: <img src="<bongo:asset src=\'img/logo.png\' />" alt="logo"/>',
			'',
			'<bongo:style src="post.css"></bongo:style>',
			'',
			'<bongo:client />',
			'',
		].join('\n'));
		expect(calls).toEqual([]);
		expect(html).toContain('<bongo:asset preload src="fonts/f.woff2" />');
		expect(html).toContain('<img src="<bongo:asset src=\'img/logo.png\' />" alt="logo"/>');
		expect(html).toContain('<bongo:style src="post.css"></bongo:style>');
		expect(html).toContain('<bongo:client />');
		expect(html).not.toContain('&lt;bongo');
	});

	test('passes <bongo:image> through, alone, inline, and inside html blocks', async () => {
		let { calls, run } = setup();
		let html = await run([
			'<bongo:image src="./hero.jpg" alt="A *hero*" sizes="(min-width: 800px) 720px, 100vw" />',
			'',
			'Inline <bongo:image src="./icon.png" alt="" width="16" /> icon.',
			'',
			'<figure>',
			'\t<bongo:image src="./frame.webp" alt="Frame"></bongo:image>',
			'\t<figcaption>The *frame*.</figcaption>',
			'</figure>',
			'',
		].join('\n'));
		expect(calls).toEqual([]);
		expect(html).toContain('<bongo:image src="./hero.jpg" alt="A *hero*" sizes="(min-width: 800px) 720px, 100vw" /><p>');
		expect(html).toContain('<p>Inline <bongo:image src="./icon.png" alt="" width="16" /> icon.</p>');
		expect(html).toContain('<bongo:image src="./frame.webp" alt="Frame"></bongo:image>');
		expect(html).not.toContain('&lt;bongo');
	});

	test('renders markdown once', async () => {
		let { run } = setup();
		let html = await run('# Title\n\nSome *text* & more.\n');
		expect(html).toBe('<h1>Title</h1>\n<p>Some <em>text</em> &amp; more.</p>\n');
	});
});

describe('heading ids', () => {
	test('keep partial output out of the id', async () => {
		let { run, utils } = setup();
		let loader = markdown({ headingIds: true }).$assets!.md!;
		let html = String((await loader('x.md', '## Hi <bongo:greet name="x" /> there\n\n## Hi <bongo:greet name="y" /> there\n\n## Hi there\n', utils)).content);
		expect(html).toBe([
			'<h2 id="hi--there">Hi <i data-partial="greet"></i> there</h2>',
			'<h2 id="hi--there-1">Hi <i data-partial="greet"></i> there</h2>',
			'<h2 id="hi-there">Hi there</h2>',
			'',
		].join('\n'));
		expect(await run('## Plain\n')).toBe('<h2>Plain</h2>\n');
	});
});
