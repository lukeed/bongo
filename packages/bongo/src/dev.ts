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

	// Route bundle-time errors to the browser overlay.
	bundler.hmr(http.send);

	// Asset-graph changes: bundler detects + re-flushes affected groups.
	// For now, any change triggers a full reload (HMR updates are not yet
	// emitted — see spec "Dev mode" open question).
	bundler.watch(async () => {
		try {
			await build(argv);
			http.send({ type: 'reload' });
		} catch (err) {
			let message = err instanceof Error ? err.message : String(err);
			if (!message.startsWith('Build failed:')) {
				http.send({ type: 'error', errors: [{ message }] });
			}
		}
	});

	// Template/content changes: clear caches and rebuild. The bundler keeps
	// its registrations (placeholders are stable) but flush() re-runs.
	await fs.watch([
		flags.layouts,
		flags.partials,
		flags.content,
	], async function (file) {
		console.log('[ dev ]', relative(flags.cwd, file));

		templates.Partials.clear();
		templates.Layouts.clear();

		try {
			await build(argv);
			http.send({ type: 'reload' });
		} catch (err) {
			let message = err instanceof Error ? err.message : String(err);
			if (!message.startsWith('Build failed:')) {
				http.send({ type: 'error', errors: [{ message }] });
			}
		}
	});
}
