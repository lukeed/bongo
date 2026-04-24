import { dim } from 'kleur/colors';

// Status line for normal progress output. Callers may pre-color parts of
// `msg` (e.g. wrap success text in green) — this helper only owns the `~>`
// prefix so the `~>` styling stays consistent across commands.
export function info(msg: string): void {
	console.log(`${dim('~>')} ${msg}`);
}

export function debug(...msg: any[]) {
	console.log('[DEBUG]', ...msg);
}

export const error = console.error.bind(console);

export function elapsed(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spin(label: string): () => void {
	let t0 = Date.now();

	if (!process.stdout.isTTY) {
		return () => {
			process.stdout.write(label + ' ' + dim(`(${elapsed(Date.now() - t0)})`) + '\n');
		};
	}

	let i = 0;
	let write = () => {
		process.stdout.write(`\r${label} ${dim(`(${SPINNER[i++ % SPINNER.length]})`)}\x1b[K`);
	};
	write();
	let timer = setInterval(write, 80);

	return () => {
		clearInterval(timer);
		process.stdout.write(`\r${label} ${dim(`(${elapsed(Date.now() - t0)})`)}\x1b[K\n`);
	};
}
