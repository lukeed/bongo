import { describe, expect, test } from 'bun:test';
import * as prefetch from './prefetch';

describe('prefetch.resolve()', () => {
	test('true resolves to "hover"', () => {
		expect(prefetch.resolve(true)).toBe('hover');
	});

	test('"hover" resolves to "hover"', () => {
		expect(prefetch.resolve('hover')).toBe('hover');
	});

	test('"tap" resolves to "tap"', () => {
		expect(prefetch.resolve('tap')).toBe('tap');
	});

	test('false resolves to "off"', () => {
		expect(prefetch.resolve(false)).toBe('off');
	});

	test('"off" resolves to "off"', () => {
		expect(prefetch.resolve('off')).toBe('off');
	});

	test('undefined resolves to "off"', () => {
		expect(prefetch.resolve(undefined)).toBe('off');
	});
});
