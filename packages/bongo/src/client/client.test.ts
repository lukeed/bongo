import { describe, expect, test } from 'bun:test';

describe('navigate()', () => {
	test('falls back to location.assign when Navigation API is absent', () => {
		// bun:test has no browser globals — stub location on globalThis.
		let assigned: string | null = null;
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(url: string) { assigned = url; },
			replace(_url: string) {},
		};

		let { navigate } = require('./index');
		navigate('https://example.com/about');

		expect(assigned).toBe('https://example.com/about');

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});

	test('falls back to location.replace when replace:true and Navigation API is absent', () => {
		let replaced: string | null = null;
		let origLocation = (globalThis as { location?: Location }).location;
		// @ts-expect-error — stubbing browser global for test
		globalThis.location = {
			href: 'https://example.com/',
			origin: 'https://example.com',
			assign(_url: string) {},
			replace(url: string) { replaced = url; },
		};

		let { navigate } = require('./index');
		navigate('https://example.com/old', { replace: true });

		expect(replaced).toBe('https://example.com/old');

		// @ts-expect-error — restore
		globalThis.location = origLocation;
	});
});
