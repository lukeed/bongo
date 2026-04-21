export function debug(...msg: any[]) {
	console.log('[DEBUG]', ...msg);
}

export const error = console.error.bind(console);
