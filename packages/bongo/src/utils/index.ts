export function debounce<T extends Function>(fn: T, delay: number): T {
	let timer: NodeJS.Timeout | null;
	// @ts-ignore
	return function () {
		// @ts-ignore
		let context = this;
		let args = arguments;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			fn.apply(context, args);
		}, delay);
	};
}

export function throttle<T extends Function>(fn: T, delay: number): T {
	let prev = 0;
	// @ts-ignore
	return function () {
		let now = Date.now();
		if (now - prev >= delay) {
			// @ts-ignore – this
			fn.apply(this, arguments);
			prev = now;
		}
	} as T;
}

export type Pool = {
	/** Start `job` once fewer than the limit run; throws the first failure of an earlier job. */
	add(job: () => Promise<unknown>): Promise<void>;
	/** Wait for every job, then throw the first failure, if any. */
	drain(): Promise<void>;
};

/**
 * Run jobs alongside other work, at most `limit` at a time. A failure is kept until `add` or `drain` throws it, so it is never unhandled.
 * @example let writes = pool(64); for (let page of pages) await writes.add(() => write(page)); await writes.drain();
 */
export function pool(limit: number): Pool {
	if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid pool limit "${limit}"; use a whole number above 0`);
	let active = 0;
	let waiting: (() => void)[] = [];
	let idle: (() => void)[] = [];
	let failure: { error: unknown } | undefined;

	// a waiting add takes over the slot; else the slot frees, and the last one wakes `drain`
	function release(): void {
		let next = waiting.shift();
		if (next) return next();
		if (--active === 0) idle.splice(0).forEach(done => done());
	}

	return {
		async add(job) {
			if (active < limit) active++;
			else await new Promise<void>(next => waiting.push(next));
			if (failure) {
				release();
				throw failure.error;
			}
			try {
				var task = job();
			} catch (error) {
				failure ??= { error };
				release();
				throw error;
			}
			task.then(() => {}, error => {
				failure ??= { error };
			}).finally(release);
		},
		async drain() {
			if (active) await new Promise<void>(done => idle.push(done));
			if (failure) throw failure.error;
		},
	};
}

/**
 * Like `Promise.all`, but it waits for every promise before it throws the first failure, so no work outlives the error.
 * @example await settle(files.map(file => sink.write(file, text)))
 */
export async function settle<T>(list: Promise<T>[]): Promise<T[]> {
	let values: T[] = [];
	for (let result of await Promise.allSettled(list)) {
		if (result.status === 'rejected') throw result.reason;
		values.push(result.value);
	}
	return values;
}
