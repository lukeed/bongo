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
});
