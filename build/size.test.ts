import { describe, expect, test } from 'vitest';
import { size } from './size';

describe('size', () => {
	test('formats bytes', () => {
		expect(size(0)).toBe('0 B ');
		expect(size(1)).toBe('1 B ');
		expect(size(999)).toBe('999 B ');
	});

	test('formats kilobytes', () => {
		expect(size(1000)).toBe('1.00 kB');
		expect(size(1500)).toBe('1.50 kB');
		expect(size(12345)).toBe('12.30 kB');
		expect(size(999999)).toBe('1.00 kB');
	});

	test('formats megabytes', () => {
		expect(size(1000000)).toBe('1.00 MB');
		expect(size(1500000)).toBe('1.50 MB');
	});

	test('defaults to 0', () => {
		expect(size()).toBe('0 B ');
	});
});
