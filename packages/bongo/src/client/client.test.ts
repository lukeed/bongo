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

describe('navigate() with the Navigation API', () => {
	type Nav = { navigate: () => { committed: Promise<unknown>; finished: Promise<unknown> } };

	async function withNavigation(nav: Nav, run: () => Promise<void>): Promise<void> {
		let prev = [Reflect.get(globalThis, 'navigation'), Reflect.get(globalThis, 'location')];
		Reflect.set(globalThis, 'navigation', nav);
		Reflect.set(globalThis, 'location', { href: 'https://example.com/' });
		try { await run(); }
		finally {
			Reflect.set(globalThis, 'navigation', prev[0]);
			Reflect.set(globalThis, 'location', prev[1]);
		}
	}

	test('resolves when a newer navigation supersedes it', async () => {
		let abort = () => Promise.reject(new DOMException('aborted', 'AbortError'));
		await withNavigation({ navigate: () => ({ committed: abort(), finished: abort() }) }, async () => {
			let { navigate } = await import('./index');
			await navigate('/about');
		});
		await new Promise(r => setTimeout(r, 10));
	});

	test('rejects on real failures', async () => {
		let boom = new Error('Navigation fetch failed: 500');
		await withNavigation({ navigate: () => ({ committed: Promise.resolve(), finished: Promise.reject(boom) }) }, async () => {
			let { navigate } = await import('./index');
			expect(navigate('/about')).rejects.toBe(boom);
		});
	});
});
