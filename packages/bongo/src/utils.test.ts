import { describe, expect, test } from 'bun:test';
import { pool, settle, throttle, debounce } from './utils/index';

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

describe('pool', () => {
	let tick = () => new Promise(next => setImmediate(next));

	test('runs at most `limit` jobs at once, and starts the next one when a job ends', async () => {
		let jobs = pool(2);
		let gates = [0, 1, 2].map(() => Promise.withResolvers<void>());
		let started = 0;
		let job = (gate: PromiseWithResolvers<void>) => () => {
			started++;
			return gate.promise;
		};
		await jobs.add(job(gates[0]));
		await jobs.add(job(gates[1]));
		let third = jobs.add(job(gates[2]));
		await tick();
		expect(started).toBe(2);

		gates[0].resolve();
		await third;
		expect(started).toBe(3);

		gates[1].resolve();
		gates[2].resolve();
		await jobs.drain();
	});

	test('keeps its limit when many adds wait at once', async () => {
		let jobs = pool(1);
		let running = 0;
		let most = 0;
		let gates = [0, 1, 2, 3].map(() => Promise.withResolvers<void>());
		let adds = gates.map(gate => jobs.add(async () => {
			most = Math.max(most, ++running);
			await gate.promise;
			running--;
		}));
		for (let gate of gates) {
			await tick();
			gate.resolve();
		}
		await Promise.all(adds);
		await jobs.drain();
		expect(most).toBe(1);
	});

	test('a job that throws at once fails the pool like one that rejects', async () => {
		let jobs = pool(2);
		await expect(jobs.add(() => {
			throw new Error('nope');
		})).rejects.toThrow('nope');
		await expect(jobs.drain()).rejects.toThrow('nope');
	});

	test('refuses a limit that is not a whole number above 0', () => {
		expect(() => pool(0)).toThrow('Invalid pool limit "0"; use a whole number above 0');
		expect(() => pool(1.5)).toThrow('Invalid pool limit "1.5"; use a whole number above 0');
	});

	test('a failed job makes the next add throw, and drain throws it once every job has ended', async () => {
		let jobs = pool(2);
		let failing = Promise.withResolvers<void>();
		let slow = Promise.withResolvers<void>();
		await jobs.add(() => failing.promise);
		await jobs.add(() => slow.promise);
		let third = jobs.add(async () => {});
		failing.reject(new Error('nope'));
		await expect(third).rejects.toThrow('nope');

		let drained = false;
		let drain = jobs.drain().finally(() => drained = true);
		await tick();
		expect(drained).toBe(false);

		slow.resolve();
		await expect(drain).rejects.toThrow('nope');
	});
});

describe('settle', () => {
	test('gives every value, in order, like Promise.all', async () => {
		expect(await settle([Promise.resolve(1), Promise.resolve(2)])).toEqual([1, 2]);
	});

	test('waits for every promise, then throws the first failure', async () => {
		let slow = Promise.withResolvers<number>();
		let ended = false;
		let all = settle([Promise.reject(new Error('first')), slow.promise.then(value => (ended = true, value)), Promise.reject(new Error('second'))]);
		let failed = false;
		all.catch(() => failed = true);
		await new Promise(next => setImmediate(next));
		expect(failed).toBe(false);

		slow.resolve(3);
		await expect(all).rejects.toThrow('first');
		expect(ended).toBe(true);
	});
});
