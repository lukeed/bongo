import { relative } from 'node:path';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';
import * as http from './utils/http';
import * as fs from './utils/fs';
import { build } from './build';

import type { Argv } from 'bongo';
import type { BuildOptions } from './build';

async function rebuild(argv: Argv, opts: BuildOptions = {}): Promise<void> {
	try {
		await build(argv, opts);
		// Success: reload the page to pick up new output.
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
}

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

	// Asset-graph changes: bundler detects + re-flushes affected groups.
	// For now, any change triggers a full reload (HMR updates are not yet
	// emitted — see spec "Dev mode" open question).
	bundler.watch(async () => {
		await rebuild(argv);
	});

	// Layout/partial changes: blow away the compiled-template caches and run
	// a full rebuild. A layout or partial edit can affect every page, so
	// narrowing isn't safe here.
	await fs.watch([flags.layouts, flags.partials], async function (file) {
		console.log('[ dev ]', relative(flags.cwd, file));
		templates.Partials.clear();
		templates.Layouts.clear();
		await rebuild(argv);
	});

	// Content changes: rebuild only the affected page. Layouts/partials caches
	// stay hot, the registries get re-walked (cheap) so sibling awareness is
	// preserved, and only the changed page is re-rendered + rewritten. Other
	// pages in `public/` are left alone.
	// Deleted files fall back to full rebuild since their removal affects
	// registries (siblings can reference gone pages via $pages/$section/$tags).
	await fs.watch([flags.content], async function (file) {
		console.log('[ dev ]', relative(flags.cwd, file));
		let rel = relative(flags.content, file);
		if (!fs.exists(file)) {
			templates.Partials.clear();
			templates.Layouts.clear();
			await rebuild(argv);
			return;
		}
		await rebuild(argv, { only: rel });
	});
}
