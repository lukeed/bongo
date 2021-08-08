import { join, resolve } from 'path';
import type { Argv } from 'bongo';

export function normalize(argv: Argv): asserts argv is Required<Argv> {
	argv.cwd = resolve(argv.cwd);

	// attach path directories
	argv.src = join(argv.cwd, argv.src || '.');
	argv.dest = join(argv.cwd, 'public');

	argv.assets = join(argv.src, 'assets');
	argv.layouts = join(argv.src, 'layouts');
	argv.content = join(argv.src, 'content');

	argv.partials = join(argv.layouts, 'partials');
	argv.shortcodes = join(argv.layouts, 'shortcodes');
}
