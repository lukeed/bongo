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
