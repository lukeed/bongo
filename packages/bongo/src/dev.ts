import { relative } from 'node:path';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';
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

	// Route bundle-time errors to the browser error overlay (Phase G).
	// hmr() must be called after http.start() so http.send is bound to the
	// live client set. It persists across resets — the dev server stays up.
	bundler.hmr(http.send);

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
		templates.Partials.clear();
		templates.Layouts.clear();

		try {
			await build(argv);
			// Success: reload the page to pick up new assets.
			// bundler.watch() is wired but not consumed here yet — Phase G layers
			// HMR on top. Full-rebuild via bundler.reset() + build() handles
			// asset-graph invalidation for now.
			http.send({ type: 'reload' });
		} catch (err) {
			// Bundler errors: bundler.flush() already pushed { type: 'error' } via
			// HMR_SEND, so the overlay is already mounted in the existing page.
			// Non-bundler errors (template compile failures, etc.) need manual
			// propagation since the bundler never saw them.
			let message = err instanceof Error ? err.message : String(err);
			if (!message.startsWith('Build failed:')) {
				http.send({ type: 'error', errors: [{ message }] });
			}
			// Don't reload — the overlay stays until the next successful build.
		}
	});
}
