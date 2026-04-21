import { describe, expect, test } from 'bun:test';
import * as http from './http';

describe('send', () => {
	test('is a function (SSE sender present)', () => {
		expect(typeof http.send).toBe('function');
	});
});

describe('reload (shim)', () => {
	test('is still callable', () => {
		expect(typeof http.reload).toBe('function');
	});
});
