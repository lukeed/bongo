import { describe, expect, test } from 'vitest';
import { throttle, debounce } from './utils/index';

describe('throttle', () => {
	test('calls function immediately on first invocation', () => {
		let count = 0;
		let fn = throttle(() => { count++ }, 100);
		fn();
		expect(count).toBe(1);
	});

	test('suppresses calls within delay window', () => {
		let count = 0;
		let fn = throttle(() => { count++ }, 100);
		fn();
		fn();
		fn();
		expect(count).toBe(1);
	});

	test('allows calls after delay has passed', async () => {
		let count = 0;
		let fn = throttle(() => { count++ }, 50);
		fn();
		expect(count).toBe(1);

		await new Promise(r => setTimeout(r, 60));
		fn();
		expect(count).toBe(2);
	});
});

describe('debounce', () => {
	test('delays execution until after delay', async () => {
		let count = 0;
		let fn = debounce(() => { count++ }, 50);
		fn();
		expect(count).toBe(0);

		await new Promise(r => setTimeout(r, 80));
		expect(count).toBe(1);
	});

	test('resets timer on subsequent calls', async () => {
		let count = 0;
		let fn = debounce(() => { count++ }, 50);
		fn();
		await new Promise(r => setTimeout(r, 30));
		fn(); // reset timer
		await new Promise(r => setTimeout(r, 30));
		expect(count).toBe(0); // still hasn't fired

		await new Promise(r => setTimeout(r, 30));
		expect(count).toBe(1);
	});

	test('only fires once for rapid calls', async () => {
		let count = 0;
		let fn = debounce(() => { count++ }, 50);
		fn(); fn(); fn(); fn(); fn();
		expect(count).toBe(0);

		await new Promise(r => setTimeout(r, 80));
		expect(count).toBe(1);
	});
});
