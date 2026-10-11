import { describe, expect, test } from 'bun:test';

import * as attrs from './attrs';

describe('parse', () => {
	test('quoted values are strings', () => {
		expect(attrs.parse(`a="x y" b='z' c=\`w\` d="2" e=""`)).toEqual({ a: 'x y', b: 'z', c: 'w', d: '2', e: '' });
	});

	test('quoted values take JavaScript escapes', () => {
		expect(attrs.parse(`a="say \\"hi\\"" b='it\\'s' c="tab\\there"`)).toEqual({ a: 'say "hi"', b: "it's", c: 'tab\there' });
	});

	test('quoted values may hold > and spaces', () => {
		expect(attrs.parse('media="(width >= 600px)" title="a > b"')).toEqual({ media: '(width >= 600px)', title: 'a > b' });
	});

	test('bare values are numbers, booleans, null, or text', () => {
		let out = attrs.parse('n=2 f=-1.5 t=true no=false x=null src=img/a.png v=1.0.0');
		expect(out).toEqual({ n: 2, f: -1.5, t: true, no: false, x: null, src: 'img/a.png', v: '1.0.0' });
	});

	test('a name without a value is true', () => {
		expect(attrs.parse('src="main.ts" async inline')).toEqual({ src: 'main.ts', async: true, inline: true });
	});

	test('maps and lists are JSON5-like data', () => {
		let out = attrs.parse(`opts={ a: 1, 'b': "x", c: [true, null, 2], d: { e: plain words } } list=[1, "two", 'three',]`);
		expect(out).toEqual({ opts: { a: 1, b: 'x', c: [true, null, 2], d: { e: 'plain words' } }, list: [1, 'two', 'three'] });
	});

	test('allows spaces around =', () => {
		expect(attrs.parse('a = "x"  b= 2')).toEqual({ a: 'x', b: 2 });
	});

	test('names may hold colons, dashes, and dots', () => {
		expect(attrs.parse('transition:name="x" data-id=1 a.b')).toEqual({ 'transition:name': 'x', 'data-id': 1, 'a.b': true });
	});

	test('an empty value is an empty string', () => {
		expect(attrs.parse('a= b')).toEqual({ a: 'b' });
		expect(attrs.parse('a=')).toEqual({ a: '' });
	});

	test('malformed values stay text', () => {
		expect(attrs.parse('a={x b=[1')).toEqual({ a: '{x', b: '[1' });
	});

	test('the last of a repeated name wins', () => {
		expect(attrs.parse('a=1 a=2')).toEqual({ a: 2 });
	});

	test('empty input', () => {
		expect(attrs.parse('')).toEqual({});
		expect(attrs.parse('   ')).toEqual({});
	});
});

describe('parse — safety', () => {
	test('never evaluates values', () => {
		let flag = globalThis as { __bongo_attrs_ran?: boolean };
		let out = attrs.parse([
			'a=(globalThis.__bongo_attrs_ran=true)',
			'b=process.exit(7)',
			'c={ x: (globalThis.__bongo_attrs_ran=true) }',
			'd=`${globalThis.__bongo_attrs_ran=true}`',
			'e=[globalThis.__bongo_attrs_ran=true]',
		].join(' '));
		expect(flag.__bongo_attrs_ran).toBeUndefined();
		expect(out).toEqual({
			a: '(globalThis.__bongo_attrs_ran=true)',
			b: 'process.exit(7)',
			c: { x: '(globalThis.__bongo_attrs_ran=true)' },
			d: '${globalThis.__bongo_attrs_ran=true}',
			e: ['globalThis.__bongo_attrs_ran=true'],
		});
	});

	test('__proto__ is an own key, never the prototype', () => {
		let out = attrs.parse('__proto__={polluted: true}');
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(Object.keys(out)).toEqual(['__proto__']);
		expect((out as { polluted?: unknown }).polluted).toBeUndefined();
	});
});
