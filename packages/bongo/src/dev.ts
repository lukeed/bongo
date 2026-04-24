import { mkdirSync } from 'node:fs';
import { relative } from 'node:path';
import { networkInterfaces } from 'node:os';
import { bold, cyan, dim, green } from 'kleur/colors';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';
import * as http from './utils/http';
import * as log from './utils/log';
import * as fs from './utils/fs';
import { build } from './build';
import { normalize } from './utils/argv';

import type { Argv } from 'bongo';
import type { BuildOptions } from './build';

// Host values that mean "bind to all interfaces". For these we resolve the
// reachable network URLs via os.networkInterfaces() and also surface a
// localhost URL for convenience. Anything else is shown verbatim.
const WILDCARDS = new Set(['0.0.0.0', '::', '']);

function listURLs(host: string, port: number): { local: string[]; network: string[] } {
	let local: string[] = [];
	let network: string[] = [];

	if (WILDCARDS.has(host)) {
		local.push(`http://localhost:${port}/`);
		let ifaces = networkInterfaces();
		for (let name in ifaces) {
			for (let ni of ifaces[name] ?? []) {
				// IPv4 non-internal only — keeps the list readable and avoids
				// link-local IPv6 noise most users don't care about.
				if (ni.family !== 'IPv4' || ni.internal) continue;
				network.push(`http://${ni.address}:${port}/`);
			}
		}
	} else {
		local.push(`http://${host}:${port}/`);
	}

	return { local, network };
}

function banner(host: string, port: number): void {
	let { local, network } = listURLs(host, port);
	// 10 = len("Network:") + 2-space gutter so URLs align across both rows.
	let label = (s: string) => bold(s.padEnd(10));
	// Loopback bindings can't be reached over the network. Show a
	// discoverability hint on the Network row (mirrors sirv-cli).
	let isLoopback = /^(localhost|127\.|::1$)/i.test(host);

	let out = '\n  ' + bold(cyan('Bongo')) + dim('  dev server') + '\n\n';
	for (let url of local) {
		out += '    ' + green('➜') + '  ' + label('Local:') + cyan(url) + '\n';
	}
	if (isLoopback) {
		out += '    ' + green('➜') + '  ' + label('Network:') + dim('use `--host` to expose') + '\n';
	} else {
		for (let url of network) {
			out += '    ' + green('➜') + '  ' + label('Network:') + cyan(url) + '\n';
		}
	}
	out += '\n';
	process.stdout.write(out);
}

function timestamp(): string {
	let d = new Date();
	let pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rebuildLabel(cwd: string, file: string): string {
	return `${dim('[' + timestamp() + ']')} ${relative(cwd, file)}`;
}

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
	bundler.preload();
	normalize(argv);

	const flags = argv as Required<Argv>;

	// Start server before build so the banner + URL appear instantly.
	// sirv reads files per-request in dev mode, so it only needs the
	// directory to exist — pages land once the build finishes.
	if (!fs.exists(flags.dest)) mkdirSync(flags.dest, { recursive: true });
	await http.start(flags);
	banner(flags.host, flags.port);

	let done = log.spin(`${dim('~>')} building`);
	await build(argv);
	done();

	// Reload any page that connected before the build finished.
	http.send({ type: 'reload' });

	// Route bundle-time errors to the browser error overlay (Phase G).
	// hmr() must be called after http.start() so http.send is bound to the
	// live client set. It persists across resets — the dev server stays up.
	bundler.hmr(http.send);

	// Asset-graph changes: bundler detects + re-flushes affected groups.
	// For now, any change triggers a full reload (HMR updates are not yet
	// emitted — see spec "Dev mode" open question).
	bundler.watch(async (diff) => {
		let done = log.spin(rebuildLabel(flags.cwd, diff.file));
		await rebuild(argv);
		done();
	});

	// Layout/partial changes: blow away the compiled-template caches and run
	// a full rebuild. A layout or partial edit can affect every page, so
	// narrowing isn't safe here.
	await fs.watch([flags.layouts, flags.partials], async function (file) {
		let done = log.spin(rebuildLabel(flags.cwd, file));
		templates.Partials.clear();
		templates.Layouts.clear();
		await rebuild(argv);
		done();
	});

	// Content changes: rebuild only the affected page. Layouts/partials caches
	// stay hot, the registries get re-walked (cheap) so sibling awareness is
	// preserved, and only the changed page is re-rendered + rewritten. Other
	// pages in `public/` are left alone.
	// Deleted files fall back to full rebuild since their removal affects
	// registries (siblings can reference gone pages via $pages/$section/$tags).
	await fs.watch([flags.content], async function (file) {
		let done = log.spin(rebuildLabel(flags.cwd, file));
		let rel = relative(flags.content, file);
		if (!fs.exists(file)) {
			templates.Partials.clear();
			templates.Layouts.clear();
			await rebuild(argv);
			done();
			return;
		}
		await rebuild(argv, { only: rel });
		done();
	});
}
