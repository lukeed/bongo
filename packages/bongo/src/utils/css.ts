import { dirname, extname, resolve, sep } from 'node:path';
import * as lightningcss from 'lightningcss';
import type { Loader } from 'bongo';
import * as browsers from './browsers';
import * as fs from './fs';
import * as loaders from './loaders';
import * as packages from './packages';

export type Targets = string | string[] | lightningcss.Targets;

export type BundleOptions = {
	entry: string;
	targets?: Targets;
	minify?: boolean;
	sourceMap?: 'inline' | false;
	cssModules?: boolean;
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
	/** Emits a local file referenced by `url()` and returns its public URL. Unset leaves every url() as written. */
	url?: (file: string) => Promise<string>;
};

export type BundleResult = {
	code: Buffer;
	map?: Buffer;
	exports?: Record<string, string>;
	dependencies: string[];
};

const MODULE_FILE = /\.module\.css$/;

function resolveTargets(input: Targets | undefined): lightningcss.Targets | undefined {
	if (input == null) return undefined;
	if (typeof input === 'string' || Array.isArray(input)) {
		return browsers.parse(input);
	}
	return input;
}

function mapExports(exp: lightningcss.CSSModuleExports | null | undefined | void): Record<string, string> | undefined {
	if (!exp) return undefined;
	let out: Record<string, string> = {};
	for (let [k, v] of Object.entries(exp)) {
		out[k] = v.name;
	}
	return out;
}

function inlineSourceMap(code: Buffer, map: Buffer): Buffer {
	let b64 = map.toString('base64');
	let comment = `\n/*# sourceMappingURL=data:application/json;base64,${b64} */\n`;
	return Buffer.concat([code, Buffer.from(comment)]);
}

const EXTERNAL = /^([a-z][a-z\d+.-]*:|\/|#)/i;
const PATH = /^(\.{0,2}\/|[a-z][a-z\d+.-]*:)/i;
const UNQUOTED = /^[^\s"'()\\\x00-\x1f\x7f]+$/;

// Same quoting as lightningcss: minified output drops quotes when the url allows it.
function serialize(url: string, minify: boolean): string {
	if (minify && UNQUOTED.test(url)) return `url(${url})`;
	return `url("${url.replace(/["\\\n]/g, c => (c === '\n' ? '\\a ' : '\\' + c))}")`;
}

// Local `url()` values resolve against the file that contains them, keeping any `?query` or `#hash`.
function locate(url: string, from: string): [file: string, suffix: string] {
	let cut = url.search(/[?#]/);
	let path = cut < 0 ? url : url.slice(0, cut);
	try { path = decodeURIComponent(path); } catch { /* keep as written */ }
	let file = resolve(dirname(from), path);
	if (!fs.exists(file)) {
		throw new Error(`Missing "${url}" referenced in ${resolve(from)}`);
	}
	return [file, cut < 0 ? '' : url.slice(cut)];
}

export async function bundle(opts: BundleOptions): Promise<BundleResult> {
	let wantModules = opts.cssModules ?? MODULE_FILE.test(opts.entry);
	let wantSourceMap = opts.sourceMap === 'inline';

	// Files the loader chain touched outside of lightningcss's own `@import`
	// tracking — we need to surface these to the watcher/HMR so edits invalidate.
	let loaderDeps = new Set<string>();

	// Cache of loader-compiled outputs keyed by absolute path. The entry file
	// is pre-run below to capture its sourcemap for `inputSourceMap`; the same
	// compiled string is served from this cache when lightningcss asks for it
	// via `resolver.read`, so we never run the chain twice for the same file.
	let compiled = new Map<string, string>();

	let inputSourceMap: string | undefined;

	// Loaders only run when the entry extension has a registered loader.
	// A `.css` entry that `@imports` a non-CSS ext (e.g. `@import "shared.scss"`)
	// won't route through loaders — use a non-`.css` entry when you need that.
	let entryExt = extname(opts.entry).substring(1);
	let needsLoader = opts.assets && opts.utils && opts.assets[entryExt] != null;

	if (needsLoader) {
		let { assets, utils } = opts as { assets: loaders.LoaderMap; utils: Loader.Utilities };

		// Pre-run the entry's loader chain so we can forward its sourcemap to
		// lightningcss. @import'd files can't receive per-file input maps
		// through the resolver API, so those maps (if any) are dropped.
		let bytes = await fs.read(opts.entry);
		let result = await loaders.run(
			opts.entry,
			new Uint8Array(bytes) as Uint8Array | string,
			assets,
			utils,
		);
		let text = typeof result.content === 'string'
			? result.content
			: new TextDecoder().decode(result.content);
		compiled.set(opts.entry, text);
		loaderDeps.add(opts.entry);
		let map = loaders.serializeMap(result.sourcemap);
		if (map) inputSourceMap = map;
	}

	// lightningcss inlines @imports without reporting them; record every read for the watcher
	let imported = new Set<string>();
	let resolver: lightningcss.Resolver = {
		resolve(specifier, from) {
			// lightningcss's own resolve, so relative, absolute, and URL imports stay as they were
			let file = specifier.startsWith('/') ? specifier : dirname(from) + sep + specifier;
			if (PATH.test(specifier) || fs.isFile(file)) return file;
			let found = packages.stylesheet(specifier, from);
			if (found) return found;
			throw new Error(`Cannot resolve @import "${specifier}" in ${resolve(from)}`);
		},
		async read(file) {
			if (resolve(file) !== resolve(opts.entry)) imported.add(resolve(file));
			let cached = compiled.get(file);
			if (cached != null) return cached;

			let ext = extname(file).substring(1);
			if (needsLoader && opts.assets![ext]) {
				let { assets, utils } = opts as { assets: loaders.LoaderMap; utils: Loader.Utilities };
				let bytes = await fs.read(file);
				let result = await loaders.run(
					file,
					new Uint8Array(bytes) as Uint8Array | string,
					assets,
					utils,
				);
				loaderDeps.add(file);
				let text = typeof result.content === 'string'
					? result.content
					: new TextDecoder().decode(result.content);
				compiled.set(file, text);
				return text;
			}
			return fs.read(file, 'utf8') as Promise<string>;
		},
	};

	let result = await lightningcss.bundleAsync({
		filename: opts.entry,
		minify: opts.minify ?? false,
		sourceMap: wantSourceMap,
		cssModules: wantModules ? true : undefined,
		targets: resolveTargets(opts.targets),
		resolver,
		inputSourceMap,
		analyzeDependencies: opts.url ? true : undefined,
	});

	let code = Buffer.isBuffer(result.code) ? result.code : Buffer.from(result.code);
	let map = result.map ? (Buffer.isBuffer(result.map) ? result.map : Buffer.from(result.map)) : undefined;

	let files = new Set<string>();
	if (opts.url) {
		let text = code.toString('utf8');
		for (let dep of result.dependencies || []) {
			if (dep.type !== 'url') continue;
			let value = dep.url;
			if (value && !EXTERNAL.test(value)) {
				let [file, suffix] = locate(value, dep.loc.filePath);
				files.add(file);
				value = await opts.url(file) + suffix;
			}
			text = text.replace(`url("${dep.placeholder}")`, () => serialize(value, opts.minify ?? false));
		}
		code = Buffer.from(text);
	}

	let deps: string[] = [];
	for (let d of [...loaderDeps, ...imported, ...files]) {
		if (!deps.includes(d)) deps.push(d);
	}

	let out: BundleResult = {
		code: wantSourceMap && map ? inlineSourceMap(code, map) : code,
		dependencies: deps,
	};

	if (!wantSourceMap && map) out.map = map;

	let exports = mapExports(result.exports);
	if (exports) out.exports = exports;

	return out;
}
