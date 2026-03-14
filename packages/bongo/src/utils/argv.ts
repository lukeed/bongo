import { resolve } from 'node:path';
import type { Argv } from 'bongo';

export function normalize(argv: Argv): asserts argv is Required<Argv> {
	argv.cwd = resolve(argv.cwd);
	argv.debug = !!argv.debug;
	argv.dev = !!argv.dev;

	// attach path directories
	argv.src = resolve(argv.cwd, argv.src || '.');
	argv.dest = resolve(argv.cwd, 'public');

	argv.assets = resolve(argv.src, 'assets');
	argv.content = resolve(argv.src, 'content');
	argv.partials = resolve(argv.src, 'partials');
	argv.layouts = resolve(argv.src, 'layouts');

	const { PORT, HOST } = process.env;
	argv.port = argv.port || PORT && +PORT || 3000;
	argv.host = argv.host || HOST || 'localhost';
}
