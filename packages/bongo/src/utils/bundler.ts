import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { BundleError, Plugin, RolldownError } from 'rolldown';
import type { Loader } from 'bongo';
import * as browsers from './browsers';
import * as css from './css';
import * as fs from './fs';
import * as loaders from './loaders';

let rd: typeof import('rolldown');

async function loadRolldown() {
	return rd ||= await import('rolldown');
}

export function preload(): void {
	loadRolldown();
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
	// Absolute path of the file whose change triggered this diff. Consumers
	// (e.g. the dev server) use this purely for logging — resolution logic
	// should work off `changed` instead.
	file: string;
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

type FlushContext = {
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
};

// Extensions rolldown's resolver + oxc transform handle natively. If every
// entry in a JS group falls under this set, the loader plugin is pointless —
// load() would return null for every module — so we skip installing it.
const NATIVE_JS_EXTS = new Set(['ts', 'js', 'cjs', 'mjs', 'css', 'json']);

// Rolldown plugin that routes entries/imports through the `$assets` loader
// chain. Fires only for extensions the user has registered a loader for —
// native extensions (.ts/.js/.css/.json) fall through to rolldown's builtins.
function loaderPlugin(assets: loaders.LoaderMap, utils: Loader.Utilities): Plugin {
	return {
		name: 'bongo:loaders',
		async load(id) {
			let ext = path.extname(id).substring(1);
			if (!assets[ext]) return null;

			let bytes = await fs.read(id);
			let result = await loaders.run(
				id,
				new Uint8Array(bytes) as Uint8Array | string,
				assets,
				utils,
			);

			let code = typeof result.content === 'string'
				? result.content
				: new TextDecoder().decode(result.content);
			let map = loaders.serializeMap(result.sourcemap);
			return map ? { code, map } : { code };
		},
	};
}

async function flushJsGroup(
	regs: Registration[],
	outDir: string,
	outputs: Map<Placeholder, OutputInfo>,
	_warnings: Warning[],
	ctx: FlushContext,
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

	// `target` is an oxc transform option on InputOptions.transform. `cfg.target`
	// is a browserslist query; parse to lightningcss Targets then translate to
	// rolldown's esbuild-style string[] (e.g. ['chrome120', 'ios17']).
	// https://rolldown.rs/reference/InputOptions.transform#target
	let transform = cfg.target
		? { target: browsers.translate(browsers.parse(cfg.target)) }
		: undefined;

	// Only install the loader plugin if at least one entry in this group uses
	// a non-native extension — otherwise every load() call would return null
	// and we'd pay the JS↔native boundary cost for nothing.
	let needsLoader = ctx.assets && ctx.utils && regs.some(r => {
		let ext = path.extname(r.entry).substring(1);
		return !NATIVE_JS_EXTS.has(ext) && ctx.assets![ext] != null;
	});
	let plugins = needsLoader
		? [loaderPlugin(ctx.assets!, ctx.utils!)]
		: undefined;

	let bundle = await rd.rolldown({
		input,
		resolve: {
			extensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
			mainFields: ['browser', 'module', 'jsnext', 'main'],
			conditionNames: ['browser', 'import', 'production'],
		},
		transform,
		plugins,
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
	ctx: FlushContext,
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
			assets: ctx.assets,
			utils: ctx.utils,
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

// Map a caught error to a BuildError, pulling location info from the first
// RolldownError in a BundleError wrapper when present, otherwise from the
// error itself (which may carry `loc`/`frame` directly). Falls back to
// message-only for unknown shapes.
function toBuildError(err: unknown, fallbackFile?: string): BuildError {
	let base: BuildError = {
		message: err instanceof Error ? err.message : String(err),
	};
	if (fallbackFile) base.file = fallbackFile;

	if (err instanceof Error) {
		let error = ((err as BundleError).errors?.[0] || err) as RolldownError;
		if (error.frame) base.frame = error.frame;
		if (error.id) base.file = error.id;
		if (error.loc) {
			if (error.loc.file) base.file = error.loc.file;
			if (typeof error.loc.line === 'number') base.line = error.loc.line;
			if (typeof error.loc.column === 'number') base.column = error.loc.column;
		}
	}
	return base;
}

export async function flush(opts: {
	outDir: string;
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
}): Promise<FlushResult> {
	let warnings: Warning[] = [];
	let errors: BuildError[] = [];
	let outputs: Map<Placeholder, OutputInfo> = new Map();

	let ctx: FlushContext = { assets: opts.assets, utils: opts.utils };

	let jobs = [...GROUPS.entries()].map(async ([_groupKey, regs]) => {
		if (regs.length === 0) return;
		let kind = regs[0].cfg.kind;
		try {
			if (kind === 'js') {
				await flushJsGroup(regs, opts.outDir, outputs, warnings, ctx);
			} else {
				await flushCssGroup(regs, opts.outDir, outputs, warnings, ctx);
			}
		} catch (err) {
			errors.push(toBuildError(err, regs.map(r => r.entry).join(', ')));
		}
	});

	await Promise.all(jobs);

	LAST_OUTPUTS = outputs;

	// Propagate build errors/clears to the browser overlay via HMR sender.
	if (HMR_SEND) {
		if (errors.length > 0) {
			HMR_SEND({ type: 'error', errors });
			LAST_HAD_ERRORS = true;
		} else if (LAST_HAD_ERRORS) {
			HMR_SEND({ type: 'error-clear' });
			LAST_HAD_ERRORS = false;
		}
	}

	// Extend the watch's tracked-file set with every registered entry plus
	// any newly discovered transitive deps. The entry itself must be tracked
	// for CSS groups, where lightningcss only reports @import'd files in
	// `dependencies` — the entry (bare .css with no imports) would otherwise
	// be invisible to the watcher.
	if (WATCH && WATCH.active) {
		for (let reg of REGISTRATIONS.values()) WATCH.files.add(reg.entry);
		for (let info of outputs.values()) {
			for (let dep of info.dependencies) WATCH.files.add(dep);
		}
	}

	return { outputs, warnings, errors };
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
//
// Async so we can await fs.watch() and capture the disposer before returning
// the Unsubscribe — this ensures unsub() actually closes the FSWatchers
// instead of only flipping a flag (critical on Linux where inotify emits an
// ENOENT error when a watched path is removed before the watcher is closed).
export async function watch(cb: (diff: WatchDiff) => void): Promise<Unsubscribe> {
	let state: WatchState = { callback: cb, files: new Set(), active: true };
	WATCH = state;

	// Seed known files from current REGISTRATIONS and LAST_OUTPUTS.
	for (let reg of REGISTRATIONS.values()) state.files.add(reg.entry);
	for (let info of LAST_OUTPUTS.values()) {
		for (let dep of info.dependencies) state.files.add(dep);
	}

	// Derive unique parent dirs to pass to fs.watch (dir-based watcher).
	let dirs = [...new Set([...state.files].map(f => path.dirname(f)))];

	let disposer = await fs.watch(dirs, async (file: string) => {
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

		WATCH.callback({ file, changed, reload: true });
	});

	return () => {
		if (WATCH === state) WATCH = null;
		state.active = false;
		disposer();
	};
}

// ---------------------------------------------------------------------------
// HMR sender (Phase G)
// ---------------------------------------------------------------------------

// Rolldown 1.0-rc.9 does not expose a stable standalone HMR client protocol
// usable from third-party dev servers. `hmr()` stores the sender so that
// build errors propagate to the browser overlay immediately, and the `hmr`
// message variant is reserved in the type union for forward compatibility once
// rolldown ships a stable client transport. Until then, every change that
// requires a content refresh is communicated as `{ type: 'reload' }` by
// dev.ts after a successful build; bundler only ever emits `error` and
// `error-clear` via this sender.

let HMR_SEND: ((msg: HmrMessage) => void) | null = null;
let LAST_HAD_ERRORS = false;

export function hmr(send: (msg: HmrMessage) => void): void {
	HMR_SEND = send;
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
