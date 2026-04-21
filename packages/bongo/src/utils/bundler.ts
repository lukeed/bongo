import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as css from './css';
import * as fs from './fs';

let rd: typeof import('rolldown');

// bun test resolves `import('rolldown')` to `index.d.mts` via tsconfig paths
// (root tsconfig.json maps "rolldown" → dist/index.d.mts for type-checking).
// Importing the `.d.mts` as a runtime module fails because it references a
// shared chunk (`logging-C6h4g8dA.mjs`) that is type-only and doesn't exist
// on disk. Work around by importing the `.mjs` directly via a URL relative to
// this file, which bun resolves through the filesystem instead of tsconfig
// paths. See spec C7 caveat.
const ROLLDOWN_URL = new URL('../../node_modules/rolldown/dist/index.mjs', import.meta.url).href;

async function loadRolldown() {
	if (rd) return rd;
	rd = (await import(ROLLDOWN_URL)) as typeof import('rolldown');
	return rd;
}

// ---------------------------------------------------------------------------
// Two-pass API (Phase C+)
// ---------------------------------------------------------------------------

declare const PlaceholderBrand: unique symbol;
export type Placeholder = string & { readonly [PlaceholderBrand]: true };

export type BundleConfig = {
	kind: 'js' | 'css';
	format?: 'esm' | 'cjs';                 // js only
	target?: string | string[];              // js only (rolldown target)
	targets?: import('./css').Targets;       // css only (lightningcss targets)
	minify?: boolean;                        // default false
	sourceMap?: 'inline' | false;            // default false
	cssModules?: boolean;                    // css only; auto for *.module.css
};

export type Warning = { file?: string; line?: number; column?: number; message: string };
export type BuildError = Warning & { frame?: string };

export type OutputInfo = {
	filename: string;                         // relative to outDir (the output root); hashed
	dependencies: string[];                   // absolute paths of deps in the graph
	exports?: Record<string, string>;         // CSS modules class map (css only)
};

export type FlushResult = {
	outputs: Map<Placeholder, OutputInfo>;
	warnings: Warning[];
	errors: BuildError[];
};

export type WatchDiff = {
	changed: Set<Placeholder>;
	reload: boolean;
};

export type Unsubscribe = () => void;

export type HmrMessage =
	| { type: 'hmr'; updates: unknown[] }
	| { type: 'reload' }
	| { type: 'error'; errors: BuildError[] }
	| { type: 'error-clear' };

// Internal registration shape
type Registration = { entry: string; placeholder: Placeholder; cfg: BundleConfig };

let REGISTRATIONS: Map<Placeholder, Registration> = new Map();
let GROUPS: Map<string, Registration[]> = new Map();
let LAST_OUTPUTS: Map<Placeholder, OutputInfo> = new Map();

function cfgKey(cfg: BundleConfig): BundleConfig {
	// Normalise for hashing: sort object keys, drop undefined.
	let sorted: BundleConfig = { kind: cfg.kind };
	for (let k of (Object.keys(cfg).sort() as (keyof BundleConfig)[])) {
		let v = cfg[k];
		if (v === undefined) continue;
		(sorted as Record<string, unknown>)[k] = v;
	}
	return sorted;
}

function toPlaceholder(entry: string, cfg: BundleConfig): Placeholder {
	let hash = createHash('sha256')
		.update(entry)
		.update('\0')
		.update(JSON.stringify(cfgKey(cfg)))
		.digest('hex')
		.slice(0, 16);
	return `__BONGO_BUNDLE:${hash}__` as Placeholder;
}

function toGroupKey(cfg: BundleConfig): string {
	return createHash('sha256').update(JSON.stringify(cfgKey(cfg))).digest('hex').slice(0, 16);
}

export function register(entry: string, cfg: BundleConfig): Placeholder {
	let placeholder = toPlaceholder(entry, cfg);
	if (REGISTRATIONS.has(placeholder)) return placeholder;

	let reg: Registration = { entry, placeholder, cfg };
	REGISTRATIONS.set(placeholder, reg);

	let groupKey = toGroupKey(cfg);
	let group = GROUPS.get(groupKey);
	if (!group) {
		group = [];
		GROUPS.set(groupKey, group);
	}
	group.push(reg);

	return placeholder;
}

async function flushJsGroup(
	regs: Registration[],
	outDir: string,
	outputs: Map<Placeholder, OutputInfo>,
	_warnings: Warning[],
): Promise<void> {
	await loadRolldown();
	let cfg = regs[0].cfg;

	// Deduplicate entries; build name→reg map for output matching.
	let input: Record<string, string> = {};
	let entryByName: Map<string, Registration> = new Map();
	for (let reg of regs) {
		let base = path.basename(reg.entry).replace(/\.[^.]+$/, '');
		let name = base;
		let i = 1;
		while (entryByName.has(name)) name = `${base}-${i++}`;
		input[name] = reg.entry;
		entryByName.set(name, reg);
	}

	let bundle = await rd.rolldown({
		input,
		resolve: {
			extensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
			mainFields: ['browser', 'module', 'jsnext', 'main'],
			conditionNames: ['browser', 'import', 'production'],
		},
	});

	try {
		let result = await bundle.write({
			dir: outDir,
			format: cfg.format === 'cjs' ? 'cjs' : 'esm',
			minify: cfg.minify ?? false,
			sourcemap: cfg.sourceMap === 'inline' ? 'inline' : false,
			entryFileNames: '[name].[hash].js',
			chunkFileNames: '[name].[hash].js',
			assetFileNames: '[name].[hash][extname]',
		});

		for (let chunk of result.output) {
			if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
			let reg = entryByName.get(chunk.name);
			if (!reg) continue;
			outputs.set(reg.placeholder, {
				filename: chunk.fileName,
				dependencies: Object.keys(chunk.modules ?? {}),
			});
		}
	} finally {
		await bundle.close();
	}
}

async function flushCssGroup(
	regs: Registration[],
	outDir: string,
	outputs: Map<Placeholder, OutputInfo>,
	_warnings: Warning[],
): Promise<void> {
	// CSS: one entry per bundle call, no cross-entry splitting.
	await Promise.all(regs.map(async (reg) => {
		let cfg = reg.cfg;
		let result = await css.bundle({
			entry: reg.entry,
			minify: cfg.minify,
			sourceMap: cfg.sourceMap,
			targets: cfg.targets,
			cssModules: cfg.cssModules,
		});

		let code = result.code;
		let hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
		let base = path.basename(reg.entry).replace(/\.[^.]+$/, '');
		let filename = `${base}.${hash}.css`;

		let fs = await import('node:fs/promises');
		let full = path.join(outDir, filename);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, code);

		let info: OutputInfo = {
			filename,
			dependencies: result.dependencies,
		};
		if (result.exports) info.exports = result.exports;
		outputs.set(reg.placeholder, info);
	}));
}

export async function flush(opts: { outDir: string }): Promise<FlushResult> {
	let warnings: Warning[] = [];
	let errors: BuildError[] = [];
	let outputs: Map<Placeholder, OutputInfo> = new Map();

	let jobs = [...GROUPS.entries()].map(async ([_groupKey, regs]) => {
		if (regs.length === 0) return;
		let kind = regs[0].cfg.kind;
		try {
			if (kind === 'js') {
				await flushJsGroup(regs, opts.outDir, outputs, warnings);
			} else {
				await flushCssGroup(regs, opts.outDir, outputs, warnings);
			}
		} catch (err) {
			let e = err as Error;
			errors.push({ message: e.message, file: regs.map(r => r.entry).join(', ') });
		}
	});

	await Promise.all(jobs);

	LAST_OUTPUTS = outputs;

	// Extend the watch's tracked-file set with any newly discovered deps.
	if (WATCH && WATCH.active) {
		for (let info of outputs.values()) {
			for (let dep of info.dependencies) WATCH.files.add(dep);
		}
	}

	return { outputs, warnings, errors };
}

export function resolve(p: Placeholder): string {
	let info = LAST_OUTPUTS.get(p);
	if (!info) throw new Error(`Placeholder ${p} was not in the last flush()`);
	return info.filename;
}

// ---------------------------------------------------------------------------
// Watch state (Phase F)
// ---------------------------------------------------------------------------

type WatchState = {
	callback: (diff: WatchDiff) => void;
	files: Set<string>;
	active: boolean;
};

let WATCH: WatchState | null = null;

// NOTE: utils/fs.ts `watch()` is directory-based — it accepts a list of
// directories, sets up FSWatcher per dir, and emits absolute file paths via
// the callback.  We therefore collect the unique PARENT directories of all
// tracked source files, watch those dirs, and filter incoming events against
// WATCH.files so only relevant changes propagate.
export function watch(cb: (diff: WatchDiff) => void): Unsubscribe {
	let state: WatchState = { callback: cb, files: new Set(), active: true };
	WATCH = state;

	// Seed known files from current REGISTRATIONS and LAST_OUTPUTS.
	for (let reg of REGISTRATIONS.values()) state.files.add(reg.entry);
	for (let info of LAST_OUTPUTS.values()) {
		for (let dep of info.dependencies) state.files.add(dep);
	}

	// Derive unique parent dirs to pass to fs.watch (dir-based watcher).
	let dirs = [...new Set([...state.files].map(f => path.dirname(f)))];

	// fs.watch is async (sets up watchers) but we don't need to await — the
	// watcher starts asynchronously, and any initial build already completed.
	void fs.watch(dirs, async (file: string) => {
		if (!WATCH || !WATCH.active) return;
		if (!WATCH.files.has(file)) return;

		// Find placeholders whose dep graph or entry path contains this file.
		let changed: Set<Placeholder> = new Set();
		for (let [placeholder, info] of LAST_OUTPUTS.entries()) {
			if (info.dependencies.includes(file)) changed.add(placeholder);
		}
		for (let reg of REGISTRATIONS.values()) {
			if (reg.entry === file) changed.add(reg.placeholder);
		}

		if (changed.size === 0) return;

		WATCH.callback({ changed, reload: true });
	});

	return () => {
		if (WATCH === state) WATCH = null;
		state.active = false;
	};
}

// Phase G implements real HMR behaviour.
export function hmr(_send: (msg: HmrMessage) => void): void {
	// no-op until Phase G
}

// ---------------------------------------------------------------------------
// reset — clears both legacy state and new two-pass state
// ---------------------------------------------------------------------------

// TODO: invalidate bundler cache for dev server
export function reset() {
	REGISTRATIONS = new Map();
	GROUPS = new Map();
	LAST_OUTPUTS = new Map();
	// WATCH is intentionally NOT cleared — the dev server keeps the watcher
	// alive across rebuilds triggered by bundler.reset() + build().
}
