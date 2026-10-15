import { describe, expect, test } from 'bun:test';
import { frontmatter } from './utils/templates';

describe('frontmatter', () => {
	test('returns empty value and zero offset for content without frontmatter', () => {
		let result = frontmatter('hello world');
		expect(result.offset).toBe(0);
		expect(result.value).toEqual({});
	});

	test('parses simple key-value pairs', () => {
		let input = '---\ntitle: Hello\nauthor: Luke\n---\nBody content';
		let result = frontmatter(input);

		expect(result.offset).toBeGreaterThan(0);
		expect(result.value).toEqual({
			title: 'Hello',
			author: 'Luke',
		});
	});

	test('handles values with colons', () => {
		let input = '---\nurl: https://example.com\n---\nBody';
		let result = frontmatter(input);

		expect(result.value).toEqual({
			url: 'https://example.com',
		});
	});

	test('returns correct offset to skip frontmatter', () => {
		let fm = '---\ntitle: Test\n---';
		let body = '\nHello';
		let input = fm + body;
		let result = frontmatter(input);

		expect(result.offset).toBe(fm.length);
		expect(input.substring(result.offset)).toBe(body);
	});

	test('returns zero offset for malformed frontmatter', () => {
		let input = '---\ntitle: Test\nno closing delimiter';
		let result = frontmatter(input);
		expect(result.offset).toBe(0);
		expect(result.value).toEqual({});
	});

	test('handles content that starts with --- but is not frontmatter', () => {
		let input = '--- not frontmatter';
		let result = frontmatter(input);
		expect(result.offset).toBe(0);
	});

	test('handles windows-style line endings', () => {
		let input = '---\r\ntitle: Hello\r\n---\r\nBody';
		let result = frontmatter(input);
		expect(result.value).toEqual({ title: 'Hello' });
		expect(result.offset).toBeGreaterThan(0);
	});

	test('strips double quotes from values', () => {
		let input = '---\ntitle: "This is a title"\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.title).toBe('This is a title');
	});

	test('strips single quotes from values', () => {
		let input = "---\nsummary: 'short desc'\n---\nBody";
		let result = frontmatter(input);
		expect(result.value.summary).toBe('short desc');
	});

	test('preserves unquoted values', () => {
		let input = '---\ntag: demo\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.tag).toBe('demo');
	});

	test('strips quotes from empty string values', () => {
		let input = '---\nempty: ""\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.empty).toBe('');
	});

	test('preserves mismatched quotes', () => {
		let input = '---\nweird: "foo\'\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.weird).toBe('"foo\'');
	});

	test('preserves quotes within the value', () => {
		let input = '---\ntitle: Use "quotes" carefully\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.title).toBe('Use "quotes" carefully');
	});

	test('strips quotes and preserves internal spaces', () => {
		let input = '---\nphrase: "Hello World"\n---\nBody';
		let result = frontmatter(input);
		expect(result.value.phrase).toBe('Hello World');
	});

	test('types values as YAML does', () => {
		let input = [
			'---',
			'title: Hello',
			'count: 42',
			'hidden: true',
			'draft: false',
			'cover: null',
			'version: "1.0"',
			'date: 2020-12-06T11:31:00-08:00',
			'tags: [a, b]',
			'authors:',
			'  - name: Luke',
			'    url: https://lukeed.com',
			'meta:',
			'  og:image: hero.png',
			'---',
			'Body',
		].join('\n');
		expect(frontmatter(input).value).toEqual({
			title: 'Hello',
			count: 42,
			hidden: true,
			draft: false,
			cover: null,
			version: '1.0',
			date: '2020-12-06T11:31:00-08:00',
			tags: ['a', 'b'],
			authors: [{ name: 'Luke', url: 'https://lukeed.com' }],
			meta: { 'og:image': 'hero.png' },
		});
	});

	test('accepts an empty block', () => {
		let input = '---\n---\nBody';
		expect(frontmatter(input)).toEqual({ offset: 7, value: {} });
		expect(frontmatter('---\n# nothing yet\n---\nBody').value).toEqual({});
	});

	test('needs the closing fence on its own line', () => {
		let input = '---\ntitle: a\n---\nsummary: Fast --- mutates\n';
		let result = frontmatter('---\nsummary: Fast --- mutates\ntitle: a\n---\nBody');
		expect(result.value).toEqual({ summary: 'Fast --- mutates', title: 'a' });
		expect(frontmatter(input).offset).toBe(16);
	});

	test('names the line of a syntax error, counted from the top of the file', () => {
		expect(() => frontmatter('---\ntitle: a\ntitle: b\n---\n')).toThrow('Invalid frontmatter: duplicate key "title" at line 3');
		expect(() => frontmatter('---\ntitle: a\n  oops: b\n---\n')).toThrow('Invalid frontmatter: bad indentation at line 3');
	});

	test('must be a map', () => {
		expect(() => frontmatter('---\n- a\n- b\n---\n')).toThrow('Invalid frontmatter: expected "key: value" lines');
		expect(() => frontmatter('---\njust text\n---\n')).toThrow('Invalid frontmatter: expected "key: value" lines');
	});
});

describe('collect', () => {
	test('loads TypeScript partials', async () => {
		let { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
		let { tmpdir } = await import('node:os');
		let { join } = await import('node:path');
		let templates = await import('./utils/templates');

		let dir = mkdtempSync(join(tmpdir(), 'bongo-partials-'));
		let partials = join(dir, 'partials');
		mkdirSync(partials);
		mkdirSync(join(dir, 'layouts'));
		writeFileSync(join(partials, 'badge.ts'), [
			'type Args = { name: string };',
			'export default function (args: Args): string {',
			'\treturn `<b>${args.name}</b>`;',
			'}',
		].join('\n'));

		try {
			templates.Partials.clear();
			let argv = { layouts: join(dir, 'layouts'), partials } as Parameters<typeof templates.collect>[0];
			let base = { $site: {}, $utils: {}, $loaders: {}, $partials: {}, $build: {}, plugins: [] } as unknown as Parameters<typeof templates.collect>[1];
			await templates.collect(argv, base);
			let render = templates.Partials.get('badge') as (args: { name: string }) => string;
			expect(await render({ name: 'hi' })).toBe('<b>hi</b>');
		} finally {
			templates.Partials.clear();
		}
	});

	test('starts from empty caches, so a deleted partial or layout leaves nothing behind', async () => {
		let { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
		let { tmpdir } = await import('node:os');
		let { join } = await import('node:path');
		let templates = await import('./utils/templates');

		let dir = mkdtempSync(join(tmpdir(), 'bongo-partials-'));
		let partials = join(dir, 'partials');
		let layouts = join(dir, 'layouts');
		mkdirSync(partials);
		mkdirSync(layouts);
		writeFileSync(join(partials, 'a.hbs'), 'a');
		writeFileSync(join(partials, 'b.hbs'), 'b');
		writeFileSync(join(layouts, 'html.hbs'), '{{{ $page.content }}}');
		writeFileSync(join(layouts, 'old.hbs'), 'old');

		try {
			let argv = { layouts, partials } as Parameters<typeof templates.collect>[0];
			let base = { $site: {}, $utils: {}, $loaders: {}, $partials: {}, $build: {}, plugins: [] } as unknown as Parameters<typeof templates.collect>[1];
			await templates.collect(argv, base);
			expect([templates.Partials.has('b'), 'b' in templates.blocks, templates.Layouts.has('old.hbs')]).toEqual([true, true, true]);

			rmSync(join(partials, 'b.hbs'));
			rmSync(join(layouts, 'old.hbs'));
			await templates.collect(argv, base);
			expect([templates.Partials.has('b'), 'b' in templates.blocks, templates.Layouts.has('old.hbs')]).toEqual([false, false, false]);
			expect([...templates.Partials.keys()]).toEqual(['a']);
		} finally {
			templates.Partials.clear();
			templates.Layouts.clear();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
