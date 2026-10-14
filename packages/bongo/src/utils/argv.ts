import { resolve } from 'node:path';
import type { Argv } from 'bongo';

export function normalize(argv: Argv): asserts argv is Required<Argv> {
	argv.cwd = resolve(argv.cwd);
	argv.debug = !!argv.debug;
	argv.dev = !!argv.dev;
	argv.write = !!argv.write;

	// attach path directories
	argv.src = resolve(argv.cwd, argv.src || '.');
	argv.dest = resolve(argv.cwd, 'public');

	argv.assets = resolve(argv.src, 'assets');
	argv.content = resolve(argv.src, 'content');
	argv.data = resolve(argv.src, 'data');
	argv.partials = resolve(argv.src, 'partials');
	argv.layouts = resolve(argv.src, 'layouts');

	// Bare `--host` (no value) → mri returns boolean `true`. Treat it as
	// "expose on all interfaces", matching sirv-cli's `--host --dev` shorthand.
	// Bare `--port` (no value) is nonsensical — drop it so env/default wins.
	if ((argv.host as unknown) === true) argv.host = '0.0.0.0';
	if ((argv.port as unknown) === true) argv.port = undefined;

	const { PORT, HOST } = process.env;
	argv.port = argv.port || PORT && +PORT || 3000;
	argv.host = argv.host || HOST || 'localhost';
}
