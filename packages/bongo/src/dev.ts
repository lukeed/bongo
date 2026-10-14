import { dirname, relative, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { bold, cyan, dim, green } from 'kleur/colors';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';
import * as http from './utils/http';
import * as log from './utils/log';
import * as fs from './utils/fs';
import * as output from './utils/output';
import { build, imports, prepare } from './build';
import { LoadError } from './utils/config';
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
			log.error(message);
			http.send({ type: 'error', errors: [{ message }] });
		}
		// Don't reload — the overlay stays until the next successful build.
	}
}

type Change = 'assets' | 'content' | 'inputs' | 'templates';

function loadError(err: unknown): LoadError | undefined {
	for (let e = err; e instanceof Error; e = e.cause) {
		if (e instanceof LoadError) return e;
	}
}

export async function dev(argv: Argv) {
	argv.dev = true;
	bundler.preload();
	normalize(argv);

	const flags = argv as Required<Argv>;

	// The output lives in memory, so a `bongo build` of the same site never clobbers it; `--write` also writes public/.
	const sink = output.memory(flags.dest, flags.write ? output.disk(flags) : undefined);

	// Start server before build so the banner + URL appear instantly; page requests wait until the first build settles.
	let built!: () => void;
	http.hold(new Promise<void>(resolve => built = resolve));
	await http.start(flags, sink);
	banner(flags.host, flags.port);

	// changes by file; one runner turns all that piled up during a build (a git checkout, say) into one rebuild
	let pending: Map<string, Change> = new Map();
	let running: Promise<void> | undefined;

	function schedule(file: string, change: Change): void {
		pending.set(file, change);
		running ??= drain();
	}

	async function drain(): Promise<void> {
		while (pending.size) {
			// a burst of events lands in one batch
			await new Promise(r => setTimeout(r, 50));
			let batch = new Map(pending);
			pending.clear();
			try {
				await run(batch);
			} catch (err) {
				log.error(err instanceof Error ? err.stack ?? err.message : String(err));
			}
		}
		running = undefined;
	}

	async function run(batch: Map<string, Change>): Promise<void> {
		let files = [...batch.keys()];
		let changes = new Set(batch.values());
		let more = files.length > 1 ? dim(` and ${files.length - 1} more`) : '';
		let done = log.spin(rebuildLabel(flags.cwd, files[0]) + more);

		if (changes.has('inputs') && !await reload()) return done();

		// Layout/partial changes: blow away the compiled-template caches and run
		// a full rebuild. A layout or partial edit can affect every page, so
		// narrowing isn't safe here.
		// Deleted files fall back to full rebuild since their removal affects
		// registries (siblings can reference gone pages via $pages/$section/$tags).
		let deleted = files.some(file => !fs.exists(file));
		if (deleted || changes.has('inputs') || changes.has('templates')) {
			templates.Partials.clear();
			templates.Layouts.clear();
		}

		// Content changes: rebuild only the affected page. Layouts/partials caches
		// stay hot, the registries get re-walked (cheap) so sibling awareness is
		// preserved, and only the changed page is re-rendered + rewritten. Other
		// pages in `public/` are left alone.
		let narrow = files.length === 1 && changes.has('content') && !deleted;
		await rebuild(argv, { inputs, sink, only: narrow ? relative(flags.content, files[0]) : undefined });
		await track();
		done();
	}

	// Config and data changes: load both again, then rebuild everything.
	// Every file they ever read stays watched, so a fix to a broken one is seen.
	let tracked = new Set([flags.data]);
	let stop: fs.WatchDisposer = () => {};

	async function follow(): Promise<fs.WatchDisposer> {
		let dirs = [...new Set([...tracked].map(file => dirname(file)))];
		let stops = await Promise.all([
			fs.watch(dirs, changed, { recursive: false }),
			fs.watch([flags.data], changed),
		]);
		return () => stops.forEach(stop => stop());
	}

	function changed(file: string): void {
		if (tracked.has(file) || file.startsWith(flags.data + sep)) schedule(file, 'inputs');
	}

	// Files that data modules import from outside content/ count as inputs too.
	async function track(): Promise<void> {
		let size = tracked.size;
		imports().forEach(file => tracked.add(file));
		if (tracked.size === size) return;
		stop();
		stop = await follow();
	}

	async function reload(): Promise<boolean> {
		try {
			var next = await prepare(argv);
		} catch (err) {
			let failed = loadError(err);
			let message = err instanceof Error ? err.message : String(err);
			failed?.files.forEach(file => tracked.add(file));
			stop();
			stop = await follow();
			log.error(message);
			http.send({ type: 'error', errors: [failed ? failed.error : { message }] });
			return false;
		}

		inputs = next;
		next.files.forEach(file => tracked.add(file));
		stop();
		stop = await follow();
		return true;
	}

	// Watch before the first build, so nothing changed during it is missed; the runner waits for it.
	running = Promise.resolve();

	// Asset-graph changes: bundler detects + re-flushes affected groups.
	// For now, any change triggers a full reload (HMR updates are not yet
	// emitted — see spec "Dev mode" open question).
	bundler.watch(diff => schedule(diff.file, 'assets'), flags.content);
	await fs.watch([flags.layouts, flags.partials], file => schedule(file, 'templates'));
	await fs.watch([flags.content], file => schedule(file, 'content'));
	stop = await follow();

	let done = log.spin(`${dim('~>')} building`);
	let inputs = await prepare(argv).catch(err => {
		built();
		throw err;
	});
	inputs.files.forEach(file => tracked.add(file));
	stop();
	stop = await follow();
	await build(argv, { inputs, sink }).finally(async () => {
		built();
		await track();
	});
	done();

	// Reload any page that connected before the build finished.
	http.send({ type: 'reload' });

	// Route bundle-time errors to the browser error overlay (Phase G).
	// hmr() must be called after http.start() so http.send is bound to the
	// live client set. It persists across resets — the dev server stays up.
	bundler.hmr(http.send);

	running = pending.size ? drain() : undefined;
}
