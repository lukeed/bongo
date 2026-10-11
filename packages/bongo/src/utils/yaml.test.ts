import { describe, expect, test } from 'bun:test';

import * as yaml from './yaml';

describe('parse — scalars', () => {
	test('plain strings', () => {
		expect(yaml.parse('title: Hello world')).toEqual({ title: 'Hello world' });
	});

	test('numbers', () => {
		expect(yaml.parse('a: 1\nb: -2.5\nc: 1e3\nd: 0\ne: 0.25')).toEqual({ a: 1, b: -2.5, c: 1000, d: 0, e: 0.25 });
	});

	test('number-like text stays a string', () => {
		let out = yaml.parse('v: 1.0.0\nzip: 01234\nplus: +1\nfrac: .5\nhex: 0x1F\nhuge: 1e999\nsep: 1_000');
		expect(out).toEqual({ v: '1.0.0', zip: '01234', plus: '+1', frac: '.5', hex: '0x1F', huge: '1e999', sep: '1_000' });
	});

	test('booleans and null', () => {
		let out = yaml.parse('a: true\nb: False\nc: TRUE\nd: null\ne: ~\nf:\ng: Null');
		expect(out).toEqual({ a: true, b: false, c: true, d: null, e: null, f: null, g: null });
	});

	test('yes, no, on, and off stay strings', () => {
		expect(yaml.parse('a: yes\nb: no\nc: on\nd: off')).toEqual({ a: 'yes', b: 'no', c: 'on', d: 'off' });
	});

	test('dates and times stay strings', () => {
		let out = yaml.parse('a: 2020-12-06\nb: 2020-12-06T11:31:00-08:00\nc: 2017-02-22T02:48:07.438Z\nd: 12:30');
		expect(out).toEqual({ a: '2020-12-06', b: '2020-12-06T11:31:00-08:00', c: '2017-02-22T02:48:07.438Z', d: '12:30' });
	});

	test('double quotes support escapes', () => {
		expect(yaml.parse('a: "x\\ty \\"q\\" \\u00e9 \\x41 \\\\ \\n"')).toEqual({ a: 'x\ty "q" é A \\ \n' });
	});

	test('single quotes keep backslashes and double a quote to escape it', () => {
		expect(yaml.parse("a: 'it''s C:\\path'")).toEqual({ a: "it's C:\\path" });
	});

	test('quoted values are always strings', () => {
		expect(yaml.parse('a: "1"\nb: \'true\'\nc: ""\nd: "null"')).toEqual({ a: '1', b: 'true', c: '', d: 'null' });
	});

	test('comments', () => {
		let out = yaml.parse('# heading\ntitle: Hi # trailing\nlang: C#\nissue: "#1" # note\n  # indented comment\nlast: x');
		expect(out).toEqual({ title: 'Hi', lang: 'C#', issue: '#1', last: 'x' });
	});

	test('a comment right after the colon or dash leaves the value empty', () => {
		expect(yaml.parse('a: # none\nb: # nested\n  c: 1\nd:\n  - # empty\n  -  # nested\n    - e')).toEqual({ a: null, b: { c: 1 }, d: [null, ['e']] });
	});

	test('a value that is not one whole quoted string or collection stays plain text', () => {
		let out = yaml.parse([
			"a: 'foid' has been renamed to 'uid'!",
			'b: "x" y',
			'c: [WIP!!] HackerNews PWA',
			'd: @arr/every',
			'e: `PWA` plugin for `gzip`',
			'f: "unterminated',
			'g: {a: 1',
		].join('\n'));
		expect(out).toEqual({
			a: "'foid' has been renamed to 'uid'!",
			b: '"x" y',
			c: '[WIP!!] HackerNews PWA',
			d: '@arr/every',
			e: '`PWA` plugin for `gzip`',
			f: '"unterminated',
			g: '{a: 1',
		});
	});

	test('values keep colons after the first ": "', () => {
		let out = yaml.parse('url: https://example.com/a\nsummary: Install with: brew install x');
		expect(out).toEqual({ url: 'https://example.com/a', summary: 'Install with: brew install x' });
	});

	test('keys may contain colons, spaces, and quotes', () => {
		expect(yaml.parse('og:image: a.png\n"a b": 1\nit\'s: x')).toEqual({ 'og:image': 'a.png', 'a b': 1, "it's": 'x' });
	});

	test('windows line endings', () => {
		expect(yaml.parse('a: 1\r\nb:\r\n  - x\r\n')).toEqual({ a: 1, b: ['x'] });
	});
});

describe('parse — collections', () => {
	test('inline lists', () => {
		expect(yaml.parse('tags: [a, b c, "d, e", 1, true, null]')).toEqual({ tags: ['a', 'b c', 'd, e', 1, true, null] });
		expect(yaml.parse('a: []\nb: [x,]')).toEqual({ a: [], b: ['x'] });
	});

	test('inline maps', () => {
		let out = yaml.parse('m: {a: 1, b: x y, "c": [1, {d: e}], url: https://x.com/a, empty:}');
		expect(out).toEqual({ m: { a: 1, b: 'x y', c: [1, { d: 'e' }], url: 'https://x.com/a', empty: null } });
		expect(yaml.parse('m: {}')).toEqual({ m: {} });
	});

	test('block lists', () => {
		expect(yaml.parse('tags:\n  - a\n  - 2\n  -\n  - "c"')).toEqual({ tags: ['a', 2, null, 'c'] });
	});

	test('block lists at the same indent as their key', () => {
		expect(yaml.parse('tags:\n- a\n- b\nnext: 1')).toEqual({ tags: ['a', 'b'], next: 1 });
	});

	test('nested maps', () => {
		expect(yaml.parse('a:\n  b:\n    c: 1\n  d: 2\ne: 3')).toEqual({ a: { b: { c: 1 }, d: 2 }, e: 3 });
	});

	test('lists of maps', () => {
		let out = yaml.parse('links:\n  - name: GitHub\n    href: /gh\n    tags:\n    - x\n  - name: X\n    href: /x');
		expect(out).toEqual({ links: [{ name: 'GitHub', href: '/gh', tags: ['x'] }, { name: 'X', href: '/x' }] });
	});

	test('nested lists', () => {
		expect(yaml.parse('- - a\n  - b\n- c\n-\n  - d')).toEqual([['a', 'b'], 'c', ['d']]);
	});

	test('any value at the top level', () => {
		expect(yaml.parse('')).toBe(null);
		expect(yaml.parse('# only a comment\n')).toBe(null);
		expect(yaml.parse('just text')).toBe('just text');
		expect(yaml.parse('42')).toBe(42);
		expect(yaml.parse('- a\n- b')).toEqual(['a', 'b']);
		expect(yaml.parse('[1, 2]')).toEqual([1, 2]);
	});

	test('skips a leading document marker', () => {
		expect(yaml.parse('---\na: 1')).toEqual({ a: 1 });
	});
});

describe('parse — errors', () => {
	test('duplicate keys', () => {
		expect(() => yaml.parse('a: 1\na: 2')).toThrow('duplicate key "a" at line 2');
	});

	test('a line that is not "key: value"', () => {
		expect(() => yaml.parse('a: 1\noops')).toThrow('expected "key: value" at line 2');
		expect(() => yaml.parse('title Hello\ndate: 1')).toThrow('expected "key: value" at line 1');
		expect(() => yaml.parse('a:\n  - b\n  c: 1')).toThrow('bad indentation at line 3');
		expect(() => yaml.parse('- a\nb: 1')).toThrow('expected "- item" at line 2');
	});

	test('bad indentation', () => {
		expect(() => yaml.parse('a: 1\n  b: 2')).toThrow('bad indentation at line 2');
		expect(() => yaml.parse('a:\n    b: 1\n  c: 2')).toThrow('bad indentation at line 3');
		expect(() => yaml.parse('summary: one\n  two')).toThrow('bad indentation at line 2');
	});

	test('block scalars', () => {
		expect(() => yaml.parse('a: |\n  text')).toThrow('block scalars (| and >) are not supported at line 1');
		expect(() => yaml.parse('a: >-')).toThrow('block scalars');
	});

	test('tabs in indentation', () => {
		expect(() => yaml.parse('a:\n\t- b')).toThrow('tabs are not allowed in indentation at line 2');
	});

	test('line numbers start at the given line', () => {
		expect(() => yaml.parse('a: 1\na: 2', 5)).toThrow('duplicate key "a" at line 6');
	});
});

describe('parse — safety', () => {
	test('__proto__ is an own key, never the prototype', () => {
		let out = yaml.parse('__proto__:\n  polluted: true\nm: {__proto__: 1}') as Record<string, Record<string, unknown>>;
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(Object.keys(out)).toEqual(['__proto__', 'm']);
		expect(out.m.polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});

describe('read', () => {
	test('reads a JavaScript-style value and reports where it ends', () => {
		expect(yaml.read('`a ${b}` rest', 0, true)).toEqual({ value: 'a ${b}', end: 8 });
		expect(yaml.read("'it\\'s'", 0, true)).toEqual({ value: "it's", end: 7 });
		expect(yaml.read("{a: 'x', b: [1, \"2\"]} z", 0, true)).toEqual({ value: { a: 'x', b: [1, '2'] }, end: 21 });
	});

	test('returns undefined for unterminated input', () => {
		expect(yaml.read('"abc', 0, true)).toBeUndefined();
		expect(yaml.read('[1, 2', 0, true)).toBeUndefined();
	});
});
