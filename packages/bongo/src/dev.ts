import { dirname, relative, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { bold, cyan, dim, green } from 'kleur/colors';
import * as bundler from './utils/bundler';
import * as http from './utils/http';
import * as log from './utils/log';
import * as fs from './utils/fs';
import * as output from './utils/output';
import { build, imports, loaded, prepare } from './build';
import { LoadError } from './utils/config';
import { normalize } from './utils/argv';

import type { Argv } from 'bongo';
import type { BuildOptions, Inputs } from './build';
import type { BuildError } from './utils/bundler';

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

type Change = 'assets' | 'content' | 'inputs' | 'templates';

function causeOf<T extends Error>(err: unknown, type: new (...args: never[]) => T): T | undefined {
	for (let e = err; e instanceof Error; e = e.cause) {
		if (e instanceof type) return e;
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

	// Until a build succeeds, the server has no page to show an error in, so it serves one.
	let good = false;
	let inputs: Inputs | undefined;

	// The assets/ files that the last build read outside the bundler, and each one that a failed build looked for.
	let loads: Set<string> = new Set();

	function report(errors: BuildError[]): void {
		http.send({ type: 'error', errors });
		if (!good) http.fail(errors);
	}

	async function rebuild(opts: BuildOptions = {}): Promise<void> {
		try {
			await build(argv, { inputs, sink, ...opts });
			loads = new Set(loaded());
			good = true;
			http.fail(undefined);
			// Success: reload the page to pick up new output.
			http.send({ type: 'reload' });
		} catch (err) {
			let missing = causeOf(err, fs.MissingError);
			if (missing?.file.startsWith(flags.assets + sep)) loads.add(missing.file);
			// Bundler errors: bundler.flush() already pushed { type: 'error' } via
			// HMR_SEND, so the overlay is already mounted in the existing page.
			// Non-bundler errors (template compile failures, etc.) need manual
			// propagation since the bundler never saw them.
			let message = err instanceof Error ? err.message : String(err);
			if (message.startsWith('Build failed:')) {
				if (!good) http.fail([{ message }]);
			} else {
				log.error(message);
				report([{ message }]);
			}
			// Don't reload — the overlay stays until the next successful build.
		} finally {
			// the heap kept ~400 MB of garbage from each rebuild of 10k pages; collect it in a new task, so no frame of the build pins it
			if (typeof Bun !== 'undefined') setTimeout(() => Bun.gc(true));
		}
	}

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

		if ((changes.has('inputs') || !inputs) && !await reload()) return done();

		// the memo of the last build tells which pages this change reaches; a layout, a partial, the config, or data reaches them all
		await rebuild();
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
			let failed = causeOf(err, LoadError);
			let message = err instanceof Error ? err.message : String(err);
			failed?.files.forEach(file => tracked.add(file));
			stop();
			stop = await follow();
			log.error(message);
			report([failed ? failed.error : { message }]);
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
	let asset = (file: string) => {
		if (loads.has(file)) schedule(file, 'assets');
	};
	if (fs.exists(flags.assets)) await fs.watch([flags.assets], asset);
	else {
		// a new assets/ folder can hold a file before its own watcher starts
		let wait = await fs.watch([dirname(flags.assets)], async file => {
			if (file !== flags.assets || !fs.exists(file)) return;
			wait();
			await fs.watch([flags.assets], asset);
			loads.forEach(file => fs.exists(file) && asset(file));
		}, { recursive: false });
	}
	stop = await follow();

	// Route bundle-time errors to the browser error overlay (Phase G).
	// hmr() must be called after http.start() so http.send is bound to the
	// live client set. It persists across resets — the dev server stays up.
	bundler.hmr(http.send);

	// A failed first build keeps the server up: it shows the error, and the next good build reloads the page.
	// Reload any page that connected before the build finished.
	let done = log.spin(`${dim('~>')} building`);
	if (await reload()) await rebuild();
	built();
	await track();
	done();

	running = pending.size ? drain() : undefined;
}
