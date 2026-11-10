/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import * as preset from './preset';

type Tag = {
	attrs: Map<string, string>;
	textContent: string;
	setAttribute(name: string, value: string): void;
};

let added: Tag[] = [];

/**
 * `inject()` reads four things off `document`, so the test gives it those and
 * no more: a whole DOM in the process would outlive the file and reach the
 * tests that serve over HTTP.
 */
function stub(): void {
	added = [];
	Reflect.set(globalThis, 'document', {
		createElement(): Tag {
			let attrs = new Map<string, string>();
			return { attrs, textContent: '', setAttribute: (k, v) => void attrs.set(k, v) };
		},
		head: {
			appendChild(el: Tag): void {
				added.push(el);
			},
		},
		querySelector(sel: string): Tag | null {
			let name = /data-bongo-preset="([^"]+)"/.exec(sel)?.[1];
			return added.find(el => el.attrs.get('data-bongo-preset') === name) ?? null;
		},
	});
}

describe('preset.resolve()', () => {
	test('true resolves to "fade"', () => {
		expect(preset.resolve(true)).toBe('fade');
	});

	test('"fade" resolves to "fade"', () => {
		expect(preset.resolve('fade')).toBe('fade');
	});

	test('"slide" resolves to "slide"', () => {
		expect(preset.resolve('slide')).toBe('slide');
	});

	test('"initial" resolves to "initial"', () => {
		expect(preset.resolve('initial')).toBe('initial');
	});

	test('false resolves to undefined', () => {
		expect(preset.resolve(false)).toBeUndefined();
	});

	test('undefined resolves to undefined', () => {
		expect(preset.resolve(undefined)).toBeUndefined();
	});

	test('custom string is returned as-is', () => {
		expect(preset.resolve('my-custom-preset')).toBe('my-custom-preset');
	});
});

describe('preset.inject()', () => {
	afterEach(() => {
		added = [];
		Reflect.deleteProperty(globalThis, 'document');
	});

	test('wraps the preset in the "bongo" layer, so a page rule beats it', () => {
		stub();
		preset.inject('fade');
		expect(added).toHaveLength(1);
		expect(added[0].attrs.get('data-bongo-preset')).toBe('fade');
		expect(added[0].textContent).toStartWith('@layer bongo{');
		expect(added[0].textContent).toEndWith('}');
		expect(added[0].textContent).toInclude('::view-transition-old(root){animation-name:bongo-fade-out');
	});

	test('"slide" is layered too', () => {
		stub();
		preset.inject('slide');
		expect(added[0].textContent).toStartWith('@layer bongo{@keyframes bongo-slide-in');
	});

	test('"initial" adds no CSS', () => {
		stub();
		preset.inject('initial');
		expect(added).toEqual([]);
	});

	test('an unknown preset adds no CSS', () => {
		stub();
		preset.inject('my-custom-preset');
		expect(added).toEqual([]);
	});

	test('a second call adds no second tag', () => {
		stub();
		preset.inject('fade');
		preset.inject('fade');
		expect(added).toHaveLength(1);
	});
});
