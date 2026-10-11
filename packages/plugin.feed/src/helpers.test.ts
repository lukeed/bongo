import { describe, expect, test } from 'bun:test';

import * as helpers from './helpers';

describe('xml()', () => {
	test('escapes the five XML predefined entities', () => {
		expect(helpers.xml('&')).toBe('&amp;');
		expect(helpers.xml('<')).toBe('&lt;');
		expect(helpers.xml('>')).toBe('&gt;');
		expect(helpers.xml('"')).toBe('&quot;');
		expect(helpers.xml("'")).toBe('&apos;');
	});

	test('coerces null and undefined to empty string', () => {
		expect(helpers.xml(null)).toBe('');
		expect(helpers.xml(undefined)).toBe('');
	});

	test('coerces numbers and booleans via String()', () => {
		expect(helpers.xml(42)).toBe('42');
		expect(helpers.xml(true)).toBe('true');
	});

	test('passes unaffected characters through unchanged', () => {
		expect(helpers.xml('hello world')).toBe('hello world');
		expect(helpers.xml('café')).toBe('café');
	});

	test('drops characters that XML 1.0 does not allow', () => {
		expect(helpers.xml('a\u0000b\u0008c\tok\n\uFFFE\uD800😀')).toBe('abc\tok\n😀');
	});

	test('escapes mixed input correctly', () => {
		expect(helpers.xml('Tom & Jerry <3')).toBe('Tom &amp; Jerry &lt;3');
		expect(helpers.xml('"quoted"')).toBe('&quot;quoted&quot;');
		expect(helpers.xml("a&b<c>d\"e'f")).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
	});
});

describe('time()', () => {
	test('returns epoch for a Date', () => {
		let d = new Date('2025-06-15T12:00:00Z');
		expect(helpers.time(d)).toBe(d.getTime());
	});

	test('returns undefined for an invalid Date', () => {
		expect(helpers.time(new Date('not a date'))).toBeUndefined();
	});

	test('parses ISO-8601 strings', () => {
		expect(helpers.time('2025-01-01T00:00:00Z')).toBe(Date.parse('2025-01-01T00:00:00Z'));
	});

	test('returns undefined for empty string', () => {
		expect(helpers.time('')).toBeUndefined();
	});

	test('returns undefined for unparseable strings', () => {
		expect(helpers.time('not a date')).toBeUndefined();
	});

	test('passes finite numbers through', () => {
		expect(helpers.time(1700000000000)).toBe(1700000000000);
	});

	test('rejects non-finite numbers', () => {
		expect(helpers.time(NaN)).toBeUndefined();
		expect(helpers.time(Infinity)).toBeUndefined();
		expect(helpers.time(-Infinity)).toBeUndefined();
	});

	test('rejects unsupported types', () => {
		expect(helpers.time(null)).toBeUndefined();
		expect(helpers.time(undefined)).toBeUndefined();
		expect(helpers.time({})).toBeUndefined();
		expect(helpers.time(true)).toBeUndefined();
		expect(helpers.time([])).toBeUndefined();
	});
});

describe('iso()', () => {
	test('formats valid input as ISO-8601', () => {
		expect(helpers.iso('2025-06-15T12:00:00Z')).toBe('2025-06-15T12:00:00.000Z');
	});

	test('formats Date instances', () => {
		expect(helpers.iso(new Date('2025-06-15T12:00:00Z'))).toBe('2025-06-15T12:00:00.000Z');
	});

	test('returns undefined for invalid input', () => {
		expect(helpers.iso('')).toBeUndefined();
		expect(helpers.iso(null)).toBeUndefined();
		expect(helpers.iso(undefined)).toBeUndefined();
		expect(helpers.iso('garbage')).toBeUndefined();
	});
});

describe('utc()', () => {
	test('formats valid input as RFC-822-style UTC string', () => {
		expect(helpers.utc('2025-06-15T12:00:00Z')).toBe('Sun, 15 Jun 2025 12:00:00 GMT');
	});

	test('formats Date instances', () => {
		expect(helpers.utc(new Date('2025-06-15T12:00:00Z'))).toBe('Sun, 15 Jun 2025 12:00:00 GMT');
	});

	test('returns undefined for invalid input', () => {
		expect(helpers.utc('')).toBeUndefined();
		expect(helpers.utc(undefined)).toBeUndefined();
		expect(helpers.utc('garbage')).toBeUndefined();
	});
});

describe('attrs()', () => {
	test('parses double-quoted values', () => {
		expect(helpers.attrs('href="/blog" title="Blog"')).toEqual({ href: '/blog', title: 'Blog' });
	});

	test('parses single-quoted values', () => {
		expect(helpers.attrs("href='/blog'")).toEqual({ href: '/blog' });
	});

	test('parses bareword values', () => {
		expect(helpers.attrs('format=atom')).toEqual({ format: 'atom' });
	});

	test('treats no-equals as boolean true', () => {
		expect(helpers.attrs('inline')).toEqual({ inline: true });
	});

	test('returns empty object for empty or whitespace input', () => {
		expect(helpers.attrs('')).toEqual({});
		expect(helpers.attrs('   ')).toEqual({});
	});

	test('handles namespaced and dashed names', () => {
		expect(helpers.attrs('xml:lang="en" data-id="x"')).toEqual({ 'xml:lang': 'en', 'data-id': 'x' });
	});

	test('tolerates leading/trailing whitespace and a self-closing slash', () => {
		expect(helpers.attrs('  href="/x"  title="Y" /')).toEqual({ href: '/x', title: 'Y' });
	});

	test('allows spaces around =', () => {
		expect(helpers.attrs('title = "x" date= \'y\' id =z')).toEqual({ title: 'x', date: 'y', id: 'z' });
	});

	test('decodes entities in values once, and keeps backslashes as written', () => {
		expect(helpers.attrs('title="Tom &amp;amp; Jerry \\d+"')).toEqual({ title: 'Tom &amp; Jerry \\d+' });
	});
});

describe('decode()', () => {
	test('decodes the five named entities', () => {
		expect(helpers.decode('&amp;&lt;&gt;&quot;&apos;')).toBe(`&<>"'`);
	});

	test('decodes decimal numeric refs', () => {
		expect(helpers.decode('&#65;&#66;')).toBe('AB');
	});

	test('decodes hex numeric refs', () => {
		expect(helpers.decode('&#x41;&#X42;')).toBe('AB');
	});

	test('leaves unknown named entities untouched', () => {
		expect(helpers.decode('&foo;')).toBe('&foo;');
	});

	test('survives invalid numeric refs', () => {
		expect(helpers.decode('&#xZZ;')).toBe('&#xZZ;');
		expect(helpers.decode('&#1a;')).toBe('&#1a;');
		expect(helpers.decode('&#x110000;')).toBe('&#x110000;');
		expect(helpers.decode('&#0;&#x8;&#xD800;')).toBe('&#0;&#x8;&#xD800;');
	});

	test('handles mixed content', () => {
		expect(helpers.decode('Tom &amp; Jerry &lt;3 &#65;')).toBe('Tom & Jerry <3 A');
	});
});

describe('text()', () => {
	test('returns string values', () => {
		expect(helpers.text('Tom & Jerry')).toBe('Tom & Jerry');
		expect(helpers.text('')).toBe('');
	});

	test('returns empty string for boolean true', () => {
		expect(helpers.text(true)).toBe('');
	});

	test('returns empty string for undefined', () => {
		expect(helpers.text(undefined)).toBe('');
	});
});

describe('url()', () => {
	test('passes absolute http(s) URLs through unchanged', () => {
		expect(helpers.url('https://other.example/post', 'https://my.example/')).toBe('https://other.example/post');
		expect(helpers.url('http://x/y', 'https://my.example/')).toBe('http://x/y');
	});

	test('returns href unchanged when site URL is empty', () => {
		expect(helpers.url('/blog/post', '')).toBe('/blog/post');
	});

	test('resolves relative paths against site URL with or without trailing slash', () => {
		expect(helpers.url('/blog/post', 'https://my.example')).toBe('https://my.example/blog/post');
		expect(helpers.url('/blog/post', 'https://my.example/')).toBe('https://my.example/blog/post');
	});

	test('preserves a subpath in the site URL', () => {
		expect(helpers.url('/post', 'https://my.example/sub/')).toBe('https://my.example/sub/post');
	});

	test('strips multiple leading slashes from href before resolving', () => {
		expect(helpers.url('//blog/post', 'https://my.example/sub/')).toBe('https://my.example/sub/blog/post');
	});
});

describe('latest()', () => {
	test('returns the latest valid epoch', () => {
		expect(helpers.latest(['2024-01-01', '2025-06-15', '2023-12-31'])).toBe(Date.parse('2025-06-15'));
	});

	test('returns undefined for empty input', () => {
		expect(helpers.latest([])).toBeUndefined();
	});

	test('returns undefined when no values are parseable', () => {
		expect(helpers.latest(['', null, undefined, 'garbage'])).toBeUndefined();
	});

	test('skips invalid values and returns the latest of the rest', () => {
		expect(helpers.latest(['', 'garbage', '2025-01-01'])).toBe(Date.parse('2025-01-01'));
	});

	test('mixes Date instances, numbers, and strings', () => {
		let d = new Date('2025-06-15T00:00:00Z');
		expect(helpers.latest([d, Date.parse('2024-12-01'), '2023-01-01'])).toBe(d.getTime());
	});
});

describe('MIME', () => {
	test('maps known feed formats to standard MIME types', () => {
		expect(helpers.MIME.rss).toBe('application/rss+xml');
		expect(helpers.MIME.atom).toBe('application/atom+xml');
	});
});
