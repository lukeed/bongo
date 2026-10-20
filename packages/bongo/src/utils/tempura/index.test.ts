import { describe, expect, test } from 'bun:test';

import * as tempura from './index';

import type { Args, Blocks } from './index';

function echo(): Blocks {
	return { show: (args: Args) => JSON.stringify(args) };
}

describe('block arguments', () => {
	test('read quoted, bare, map, and list values', async () => {
		let render = tempura.compile(`{{#show a="x y" b='z' c=\`q\` d=3 e=ok f={ k: 1 } g=[1, 2]}}`, { async: true, props: ['ok'], blocks: echo() });
		expect(JSON.parse(await render({ ok: true }))).toEqual({ a: 'x y', b: 'z', c: 'q', d: 3, e: true, f: { k: 1 }, g: [1, 2] });
	});

	test('a ( … ) value may hold spaces, nested groups, and quotes', async () => {
		let render = tempura.compile(`{{#show docs=($page.section === 'docs') sum=(1 + (2 * 3)) text=(mark === ')' ? "a b" : 'c')}}`, { async: true, props: ['$page', 'mark'], blocks: echo() });
		expect(JSON.parse(await render({ $page: { section: 'docs' }, mark: ')' }))).toEqual({ docs: true, sum: 7, text: 'a b' });
	});

	test('nested maps and lists keep their inner groups', async () => {
		let render = tempura.compile(`{{#show m={ a: { b: [1, { c: '}' }] } } }}`, { async: true, blocks: echo() });
		expect(JSON.parse(await render({}))).toEqual({ m: { a: { b: [1, { c: '}' }] } } });
	});

	test('text it cannot read fails the compile and quotes the text', () => {
		let compile = (src: string) => () => tempura.compile(src, { async: true, props: ['$page'], blocks: echo() });
		expect(compile(`{{#show docs=$page.section === 'docs'}}`)).toThrow(`Cannot read the arguments of "show": "=== 'docs'"`);
		expect(compile(`{{#show a=(1 + 2}}`)).toThrow(`Cannot read the arguments of "show": "a=(1 + 2"`);
		expect(compile(`{{#show "x"}}`)).toThrow(`Cannot read the arguments of "show": "\\"x\\""`);
	});
});

describe('compile', () => {
	test('a tag closes after its own braces, not at the first }}', async () => {
		let render = tempura.compile(`{{#show m={ k: 1 }}}|{"a": {{ n }}}|{{ s === '}}' ? 'y' : 'n' }}|{{{ html }}}|{{! it's {a} note }}end`, { async: true, props: ['n', 's', 'html'], blocks: echo() });
		expect(await render({ n: 2, s: '}}', html: '<b>' })).toBe('{"m":{"k":1}}|{"a": 2}|y|<b>|end');
	});

	test('a value named x prints like any other name', async () => {
		let render = tempura.compile('<p>{{ x }}</p>{{#var y = x + 1}}<b>{{ y }}</b>', { props: ['x'] });
		expect(await render({ x: 1 })).toBe('<p>1</p><b>2</b>');
	});

	test('an async template compiles to an AsyncFunction', () => {
		let render = tempura.compile('', { async: true });
		expect(Object.prototype.toString.call(render)).toBe('[object AsyncFunction]');
	});

	test('loose skips keywords', () => {
		let render = tempura.compile('{{ x === null }}|{{ typeof x }}', { loose: true });
		expect(render({ x: 1 })).toBe('false|number');
	});

	test('a block name may be one character', () => {
		let render = tempura.compile('{{#b}}', { blocks: { b: () => 'ok' } });
		expect(render({})).toBe('ok');
	});

	test('esc prints a missing value as nothing', () => {
		expect(tempura.esc(null)).toBe('');
		expect(tempura.esc(undefined)).toBe('');
		expect(tempura.esc(0)).toBe('0');
	});

	test('blocks given at call time replace the compile-time blocks', async () => {
		let render = tempura.compile('{{#show a=1}}', { async: true, blocks: echo() });
		expect(await render({})).toBe('{"a":1}');
		expect(await render({}, { show: () => 'other' })).toBe('other');
	});
});
