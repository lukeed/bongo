import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import * as browsers from './browsers';
import * as css from './css';
import * as fs from './fs';
import * as images from './images';
import * as loaders from './loaders';
import * as output from './output';
import * as utils from './index';

import type { Loader } from 'bongo';
import type { BundleError, Plugin, RolldownError } from 'rolldown';

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
	kind: 'js' | 'css' | 'file' | 'image';  // file: copied as-is under a hashed name
	format?: 'esm' | 'cjs' | 'iife';        // js only
	split?: boolean;                         // js only; false builds the entry alone, with dynamic imports inlined
	target?: string | string[];              // js only (rolldown target)
	targets?: import('./css').Targets;       // css only (lightningcss targets)
	minify?: boolean;                        // default false
	sourceMap?: 'inline' | false;            // default false
	cssModules?: boolean;                    // css only; auto for *.module.css
	image?: images.Settings;                 // image only
};

export type Warning = { file?: string; line?: number; column?: number; message: string };
export type BuildError = Warning & { frame?: string };

export type OutputInfo = {
	filename: string;                         // relative to outDir (the output root); hashed
	dependencies: string[];                   // absolute paths of deps in the graph
	exports?: Record<string, string>;         // CSS modules class map (css only)
	image?: images.Info;                      // image only
};

export type FlushResult = {
	outputs: Map<Placeholder, OutputInfo>;
	warnings: Warning[];
	errors: BuildError[];
	files: string[];                          // every file written, relative to outDir
	notices: string[];                        // one line each, for the build log
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

let REGISTRATIONS: Map<string, Registration> = new Map();
let GROUPS: Map<string, Registration[]> = new Map();
let LAST_OUTPUTS: Map<Placeholder, OutputInfo> = new Map();

// Each missing file that a failed entry of the last flush names, to build the entry again when the file appears.
let MISSING: Map<string, Placeholder[]> = new Map();

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

// The placeholder of each entry and its settings, so the many pages that register one asset hash it once.
let PLACEHOLDERS: Map<string, Placeholder> = new Map();

function toPlaceholder(entry: string, cfg: BundleConfig): Placeholder {
	let key = entry + '\0' + JSON.stringify(cfg);
	let hit = PLACEHOLDERS.get(key);
	if (hit) return hit;
	let hash = createHash('sha256')
		.update(entry)
		.update('\0')
		.update(JSON.stringify(cfgKey(cfg)))
		.digest('hex')
		.slice(0, 16);
	let placeholder = `__BONGO_BUNDLE:${hash}__` as Placeholder;
	PLACEHOLDERS.set(key, placeholder);
	return placeholder;
}

function toGroupKey(entry: string, cfg: BundleConfig): string {
	let key = JSON.stringify(cfgKey(cfg)) + (cfg.split === false ? '\0' + entry : '');
	return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

const PLACEHOLDER = /__BONGO_BUNDLE:[a-f0-9]{16}__/g;

// The part of a placeholder that names its output in dev: the same for one entry and its settings, whatever its content.
function stable(placeholder: Placeholder): string {
	return placeholder.slice('__BONGO_BUNDLE:'.length, '__BONGO_BUNDLE:'.length + 8);
}

/**
 * The distinct placeholders that rendered `html` references.
 * Each is a copy, since a match shares the memory of all of `html` and would keep it alive.
 * @example placeholders(scanBongoTags(html, argv, config)) //=> ['__BONGO_BUNDLE:0123456789abcdef__']
 */
export function placeholders(html: string): string[] {
	return [...new Set(html.match(PLACEHOLDER))].map(match => Buffer.from(match, 'latin1').toString('latin1'));
}

/**
 * Drop every registration whose placeholder is not in `keep`, so assets no page uses stop being built.
 * @example retain(new Set(placeholders(html)))
 */
export function retain(keep: Set<string>): void {
	let groups: Map<string, Registration[]> = new Map();
	for (let [key, regs] of GROUPS) {
		let used = regs.filter(reg => keep.has(reg.placeholder));
		if (used.length) groups.set(key, used);
	}
	GROUPS = groups;
	REGISTRATIONS = new Map([...REGISTRATIONS].filter(([placeholder]) => keep.has(placeholder)));
}

/**
 * The entry and config that `placeholder` stands for, so a page that does not render again can register its assets again.
 * @example let [entry, cfg] = registration(placeholder) ?? []; register(entry, cfg) //=> placeholder
 */
export function registration(placeholder: string): [entry: string, cfg: BundleConfig] | undefined {
	let reg = REGISTRATIONS.get(placeholder);
	return reg && [reg.entry, reg.cfg];
}

export function register(entry: string, cfg: BundleConfig): Placeholder {
	let placeholder = toPlaceholder(entry, cfg);
	if (REGISTRATIONS.has(placeholder)) return placeholder;

	let reg: Registration = { entry, placeholder, cfg };
	REGISTRATIONS.set(placeholder, reg);

	let groupKey = toGroupKey(entry, cfg);
	let group = GROUPS.get(groupKey);
	if (!group) {
		group = [];
		GROUPS.set(groupKey, group);
	}
	group.push(reg);

	return placeholder;
}

type FlushContext = {
	sink: output.Sink;
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
	publicPath: string;
	emit: (file: string) => Promise<string>;
	files: Set<string>;
	images: images.Context;
	cwd: string;
	/** Name scripts and stylesheets by their entry and settings, not their content, so an edit changes no page that links them. */
	dev: boolean;
};

/**
 * Public URL for an output file, with each path segment percent-encoded so it is
 * safe inside CSS `url()` and HTML attributes.
 * @example href('/docs/', 'my font.1a2b3c4d.woff2') //=> '/docs/my%20font.1a2b3c4d.woff2'
 */
export function href(publicPath: string, filename: string): string {
	let encode = (part: string) => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
	return publicPath + filename.split('/').map(encode).join('/');
}

// Copies a file into outDir as `name.hash.ext` once per flush, shared by css url()s and file registrations.
function emitter(sink: output.Sink, outDir: string, files: Set<string>): (file: string) => Promise<string> {
	let done = new Map<string, Promise<string>>();
	return file => {
		let hit = done.get(file);
		if (hit) return hit;
		hit = (async () => {
			let bytes = await fs.read(file);
			let hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
			let ext = path.extname(file);
			let name = `${path.basename(file, ext)}.${hash}${ext}`;
			await sink.write(path.join(outDir, name), bytes);
			files.add(name);
			return name;
		})();
		done.set(file, hit);
		return hit;
	};
}

// Extensions rolldown's resolver + oxc transform handle natively. If every
// entry in a JS group falls under this set, the loader plugin is pointless —
// load() would return null for every module — so we skip installing it.
const NATIVE_JS_EXTS = new Set(['ts', 'js', 'cjs', 'mjs', 'css', 'json']);

// Rolldown plugin that routes entries/imports through the `$loaders`
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

type ModuleGraph = Map<string, string[]>;

// Chunks omit modules that were inlined or split away, so dependencies come from the module graph.
function graphPlugin(graph: ModuleGraph): Plugin {
	return {
		name: 'bongo:graph',
		buildEnd() {
			for (let id of this.getModuleIds()) {
				let info = this.getModuleInfo(id);
				if (info && path.isAbsolute(id)) {
					graph.set(id, [...info.importedIds, ...info.dynamicallyImportedIds]);
				}
			}
		},
	};
}

function reachable(entry: string, graph: ModuleGraph): string[] {
	let seen: Set<string> = new Set([entry]);
	for (let id of seen) {
		for (let next of graph.get(id) ?? []) {
			if (graph.has(next)) seen.add(next);
		}
	}
	return [...seen];
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
	// in path order, so two entries with one name get the same suffixes whatever order the pages registered them in
	let input: Record<string, string> = {};
	let entryByName: Map<string, Registration> = new Map();
	for (let reg of regs.toSorted((a, b) => a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0)) {
		let base = path.basename(reg.entry).replace(/\.[^.]+$/, '') + (ctx.dev ? '.' + stable(reg.placeholder) : '');
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
	let graph: ModuleGraph = new Map();
	let plugins = needsLoader
		? [loaderPlugin(ctx.assets!, ctx.utils!), graphPlugin(graph)]
		: [graphPlugin(graph)];

	let bundle = await rd.rolldown({
		input,
		cwd: ctx.cwd,
		resolve: {
			extensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
			mainFields: ['browser', 'module', 'jsnext', 'main'],
			conditionNames: ['browser', 'import', 'production'],
		},
		transform,
		plugins,
	});

	try {
		let result = await bundle.generate({
			format: cfg.format ?? 'esm',
			codeSplitting: cfg.split !== false,
			minify: cfg.minify ?? false,
			sourcemap: cfg.sourceMap === 'inline' ? 'inline' : false,
			entryFileNames: ctx.dev ? '[name].js' : '[name].[hash].js',
			chunkFileNames: '[name].[hash].js',
			assetFileNames: '[name].[hash][extname]',
		});

		await Promise.all(result.output.map(item => ctx.sink.write(path.join(outDir, item.fileName), item.type === 'chunk' ? item.code : item.source)));
		for (let chunk of result.output) {
			ctx.files.add(chunk.fileName);
			if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
			let reg = entryByName.get(chunk.name);
			if (!reg) continue;
			outputs.set(reg.placeholder, {
				filename: chunk.fileName,
				dependencies: chunk.facadeModuleId ? reachable(chunk.facadeModuleId, graph) : [],
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
			url: async file => href(ctx.publicPath, await ctx.emit(file)),
		});

		let code = result.code;
		let hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
		let base = path.basename(reg.entry).replace(/\.[^.]+$/, '');
		let filename = `${base}.${ctx.dev ? stable(reg.placeholder) : hash}.css`;

		await ctx.sink.write(path.join(outDir, filename), code);
		ctx.files.add(filename);

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
// Rolldown packs a colored code frame into `message`: keep its first line as the message, the rest as the frame.
export function toBuildError(err: unknown, fallbackFile?: string): BuildError {
	let error = err instanceof Error ? ((err as BundleError).errors?.[0] || err) as RolldownError : undefined;
	let [message, ...frame] = stripVTControlCharacters(error ? error.message : String(err)).trim().split('\n');

	let base: BuildError = { message };
	if (fallbackFile) base.file = fallbackFile;

	if (error) {
		let rest = error.frame ? stripVTControlCharacters(error.frame) : frame.join('\n');
		if (rest.trim()) base.frame = rest;
		if (error.id) base.file = error.id;
		if (error.loc) {
			if (error.loc.file) base.file = error.loc.file;
			if (typeof error.loc.line === 'number') base.line = error.loc.line;
			if (typeof error.loc.column === 'number') base.column = error.loc.column;
		}
	}
	return base;
}

/**
 * One line for an error: its message, then where it happened, relative to `root` when inside it.
 * @example summary({ message: 'Unexpected token', file: '/site/a.ts', line: 1, column: 4 }, '/site') //=> 'Unexpected token (a.ts:1:5)'
 */
export function summary(error: BuildError, root: string): string {
	if (!error.file) return error.message;
	let file = error.file;
	let dir = [root, realpathSync(root)].find(dir => file.startsWith(dir + path.sep));
	if (dir) file = path.relative(dir, file);
	return `${error.message} (${file}${error.line ? `:${error.line}:${(error.column ?? 0) + 1}` : ''})`;
}

export async function flush(opts: {
	outDir: string;
	/** The project root, which scripts name their modules from, so their bytes do not depend on the folder that the build runs in. @default process.cwd() */
	cwd?: string;
	/** Where the files go. @default the folder `outDir` on disk */
	sink?: output.Sink;
	/** Prefix for the public urls of emitted files. @default '/' */
	publicPath?: string;
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
	/** Directory that keeps encoded images between builds. @default tmpdir()/bongo/images */
	cache?: string;
	/** List image files for the dev server to encode on request, instead of writing them. @default false */
	dev?: boolean;
}): Promise<FlushResult> {
	let warnings: Warning[] = [];
	let outputs: Map<Placeholder, OutputInfo> = new Map();

	let files: Set<string> = new Set();
	let sink = opts.sink ?? output.folder(opts.outDir);
	let emit = emitter(sink, opts.outDir, files);
	let ctx: FlushContext = {
		sink,
		assets: opts.assets,
		utils: opts.utils,
		publicPath: opts.publicPath ?? '/',
		emit,
		files,
		cwd: opts.cwd ?? process.cwd(),
		dev: opts.dev ?? false,
		images: images.context({
			outDir: opts.outDir,
			sink,
			cache: opts.cache ?? path.join(tmpdir(), 'bongo', 'images'),
			dev: opts.dev ?? false,
			emit,
		}),
	};

	// css, image, and file entries are built one by one, so each failure names its own entry
	let jobs = [...GROUPS.values()].flatMap(regs => {
		let kind = regs[0]?.cfg.kind;
		if (kind === 'js') return [{ regs, run: () => flushJsGroup(regs, opts.outDir, outputs, warnings, ctx) }];
		return regs.map(reg => ({
			regs: [reg],
			async run(): Promise<void> {
				if (kind === 'css') return flushCssGroup([reg], opts.outDir, outputs, warnings, ctx);
				if (kind === 'image') {
					// a dev rebuild keeps registrations whose source was renamed or deleted since
					if (!reg.cfg.image || !fs.exists(reg.entry)) return;
					let image = await images.prepare(reg.entry, reg.cfg.image, ctx.images);
					if (!opts.dev) image.variants.forEach(variant => files.add(variant.filename));
					outputs.set(reg.placeholder, { filename: image.filename, dependencies: [reg.entry], image });
					return;
				}
				outputs.set(reg.placeholder, { filename: await ctx.emit(reg.entry), dependencies: [reg.entry] });
			},
		}));
	});

	MISSING = new Map();
	let failures = await Promise.all(jobs.map(async job => {
		try {
			await job.run();
		} catch (err) {
			let missing = utils.cause(err, fs.MissingError);
			if (missing) MISSING.set(missing.file, job.regs.map(reg => reg.placeholder));
			return toBuildError(err, job.regs.map(r => r.entry).join(', '));
		}
	}));

	let errors = failures.filter(err => err !== undefined);

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
		let files = [...REGISTRATIONS.values()].map(reg => reg.entry);
		for (let info of outputs.values()) files.push(...info.dependencies);
		await follow(WATCH, [...files, ...MISSING.keys()]);
	}

	return { outputs, warnings, errors, files: [...files], notices: [...ctx.images.notices] };
}

// ---------------------------------------------------------------------------
// Watch state (Phase F)
// ---------------------------------------------------------------------------

type WatchState = {
	callback: (diff: WatchDiff) => void;
	files: Set<string>;
	dirs: Map<string, fs.WatchDisposer>;
	active: boolean;
	skip?: string;
};

let WATCH: WatchState | null = null;

function changed(file: string): void {
	if (!WATCH || !WATCH.active) return;
	if (!WATCH.files.has(file)) return;

	// Find placeholders whose dep graph or entry path contains this file.
	let hits: Set<Placeholder> = new Set();
	for (let [placeholder, info] of LAST_OUTPUTS.entries()) {
		if (info.dependencies.includes(file)) hits.add(placeholder);
	}
	for (let reg of REGISTRATIONS.values()) {
		if (reg.entry === file) hits.add(reg.placeholder);
	}
	MISSING.get(file)?.forEach(placeholder => hits.add(placeholder));

	if (hits.size === 0) return;

	WATCH.callback({ file, changed: hits, reload: true });
}

// Track files and watch their dirs; a new parent dir replaces its child watchers so events never double up.
async function follow(state: WatchState, files: Iterable<string>): Promise<void> {
	let fresh = new Set<string>();
	for (let file of files) {
		if (state.skip && file.startsWith(state.skip + path.sep)) continue;
		if (file.split(path.sep).includes('node_modules')) continue;
		state.files.add(file);
		let dir = path.dirname(file);
		let under = (root: string) => dir === root || dir.startsWith(root + path.sep);
		if ([...state.dirs.keys()].some(under) || [...fresh].some(under)) continue;
		for (let other of fresh) if (other.startsWith(dir + path.sep)) fresh.delete(other);
		fresh.add(dir);
	}

	for (let dir of fresh) {
		let stop = await fs.watch([dir], changed);
		if (!state.active) return stop();
		state.dirs.set(dir, stop);
		for (let [other, close] of state.dirs) {
			if (other.startsWith(dir + path.sep)) {
				close();
				state.dirs.delete(other);
			}
		}
	}
}

// NOTE: utils/fs.ts `watch()` is directory-based — it accepts a list of
// directories, sets up FSWatcher per dir, and emits absolute file paths via
// the callback.  We therefore collect the unique PARENT directories of all
// tracked source files, watch those dirs, and filter incoming events against
// WATCH.files so only relevant changes propagate.
//
// Files under `skip` are left to a watcher the caller already runs (the dev
// server's content/ watcher), so one change never starts two rebuilds.
//
// Async so we can await fs.watch() and capture the disposer before returning
// the Unsubscribe — this ensures unsub() actually closes the FSWatchers
// instead of only flipping a flag (critical on Linux where inotify emits an
// ENOENT error when a watched path is removed before the watcher is closed).
export async function watch(cb: (diff: WatchDiff) => void, skip?: string): Promise<Unsubscribe> {
	let state: WatchState = { callback: cb, files: new Set(), dirs: new Map(), active: true, skip };
	WATCH = state;

	// Seed known files from current REGISTRATIONS and LAST_OUTPUTS.
	let files = [...REGISTRATIONS.values()].map(reg => reg.entry);
	for (let info of LAST_OUTPUTS.values()) files.push(...info.dependencies);
	await follow(state, files);

	return () => {
		if (WATCH === state) WATCH = null;
		state.active = false;
		for (let stop of state.dirs.values()) stop();
		state.dirs.clear();
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
	MISSING = new Map();
	// WATCH is intentionally NOT cleared — the dev server keeps the watcher
	// alive across rebuilds triggered by bundler.reset() + build().
}
