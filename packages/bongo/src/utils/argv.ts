import { resolve } from 'node:path';

import * as fs from './fs';

import type { Argv } from 'bongo';

export function normalize(argv: Argv): asserts argv is Required<Argv> {
	// Rolldown names modules by their real paths, so a symlink in cwd would change the bytes of scripts
	argv.cwd = fs.real(argv.cwd);
	argv.debug = !!argv.debug;
	argv.dev = !!argv.dev;
	// dev shows drafts, and `bongo build` leaves them out, unless the flag says otherwise
	argv.drafts = argv.drafts ?? argv.dev;
	argv.fresh = !!argv.fresh;
	argv.minify = !!argv.minify;
	argv.write = !!argv.write;
	// before the config loads, so the modules it imports can read the mode
	process.env.NODE_ENV ||= argv.dev ? 'development' : 'production';

	// attach path directories
	argv.src = resolve(argv.cwd, argv.src || '.');
	argv.dest = resolve(argv.cwd, 'public');

	argv.assets = resolve(argv.src, 'assets');
	argv.content = resolve(argv.src, 'content');
	argv.data = resolve(argv.src, 'data');
	argv.partials = resolve(argv.src, 'partials');
	argv.layouts = resolve(argv.src, 'layouts');

	const { PORT, HOST } = process.env;
	argv.port = argv.port || PORT && +PORT || 3000;
	argv.host = argv.host || HOST || 'localhost';
}
