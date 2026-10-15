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
	let running: Set<Promise<void>> = new Set();
	let failure: { error: unknown } | undefined;

	async function wait(most: number): Promise<void> {
		while (running.size > most) await Promise.race(running);
		if (failure) throw failure.error;
	}

	return {
		async add(job) {
			await wait(limit - 1);
			let task: Promise<void> = job().then(() => {}, error => {
				failure ??= { error };
			}).finally(() => running.delete(task));
			running.add(task);
		},
		drain: () => wait(0),
	};
}
