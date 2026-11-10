/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import * as preset from './preset';

let win: Window | undefined;

function mount(): void {
	let w: Window = win = new Window({ url: 'https://example.com/' });
	w.document.write('<!doctype html><html><head></head><body></body></html>');
	Reflect.set(globalThis, 'document', w.document);
}

function tags(): string[] {
	return [ ...document.head.querySelectorAll('style[data-bongo-preset]') ].map(el => el.outerHTML);
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
		win?.close();
		win = undefined;
	});

	test('wraps the preset in the "bongo" layer, so a page rule beats it', () => {
		mount();
		preset.inject('fade');
		let [ tag ] = tags();
		expect(tag).toStartWith('<style data-bongo-preset="fade">@layer bongo{');
		expect(tag).toEndWith('}</style>');
		expect(tag).toInclude('::view-transition-old(root){animation-name:bongo-fade-out');
	});

	test('"slide" is layered too', () => {
		mount();
		preset.inject('slide');
		expect(tags()[0]).toInclude('@layer bongo{@keyframes bongo-slide-in');
	});

	test('"initial" adds no CSS', () => {
		mount();
		preset.inject('initial');
		expect(tags()).toEqual([]);
	});

	test('an unknown preset adds no CSS', () => {
		mount();
		preset.inject('my-custom-preset');
		expect(tags()).toEqual([]);
	});

	test('a second call adds no second tag', () => {
		mount();
		preset.inject('fade');
		preset.inject('fade');
		expect(tags()).toHaveLength(1);
	});
});
