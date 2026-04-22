import { describe, expect, test } from 'bun:test';
import * as preset from './preset';

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

	test('false resolves to "none"', () => {
		expect(preset.resolve(false)).toBe('none');
	});

	test('"none" resolves to "none"', () => {
		expect(preset.resolve('none')).toBe('none');
	});

	test('undefined resolves to "none"', () => {
		expect(preset.resolve(undefined)).toBe('none');
	});

	test('custom string is returned as-is', () => {
		expect(preset.resolve('my-custom-preset')).toBe('my-custom-preset');
	});
});
