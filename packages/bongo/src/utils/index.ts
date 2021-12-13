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
