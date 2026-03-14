import { relative } from 'node:path';
import * as bundler from './utils/bundler';
import * as views from './utils/views';
import * as http from './utils/http';
import * as fs from './utils/fs';
import { build } from './build';

import type { Argv } from 'bongo';

export async function dev(argv: Argv) {
	argv.dev = true;

	await build(argv);
	const flags = argv as Required<Argv>;
	const server = await http.start(flags);
	console.log('~> started', server.address());

	// TODO: content -> single file rebuild
	// TODO: layouts/partials -> all content
	// TODO: assets -> invalidate bundle(s), all content
	await fs.watch([
		flags.assets,
		flags.layouts,
		flags.partials,
		flags.content,
	], async function (file) {
		console.log('[ dev ]', relative(flags.cwd, file));

		bundler.reset();
		views.Partials.clear();
		views.Layouts.clear();

		await build(argv);
		http.reload();
	});
}
