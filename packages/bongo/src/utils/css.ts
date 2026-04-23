import { extname } from 'node:path';
import * as lightningcss from 'lightningcss';
import type { Loader } from 'bongo';
import * as browsers from './browsers';
import * as fs from './fs';
import * as loaders from './loaders';

export type Targets = string | string[] | lightningcss.Targets;

export type BundleOptions = {
	entry: string;
	targets?: Targets;
	minify?: boolean;
	sourceMap?: 'inline' | false;
	cssModules?: boolean;
	assets?: loaders.LoaderMap;
	utils?: Loader.Utilities;
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

function normalizeDependencies(deps: unknown): string[] {
	if (!deps || !Array.isArray(deps)) return [];
	return (deps as unknown[])
		.map(d => (typeof d === 'string' ? d : (d as { url?: string }).url ?? ''))
		.filter(Boolean);
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

	if (opts.assets && opts.utils) {
		let { assets, utils } = opts;

		// Pre-run the entry's loader chain so we can forward its sourcemap to
		// lightningcss. @import'd files can't receive per-file input maps
		// through the resolver API, so those maps (if any) are dropped.
		let entryExt = extname(opts.entry).substring(1);
		if (assets[entryExt]) {
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
	}

	let resolver: lightningcss.Resolver | undefined;
	if (opts.assets && opts.utils) {
		let { assets, utils } = opts;
		resolver = {
			async read(file) {
				let cached = compiled.get(file);
				if (cached != null) return cached;

				let ext = extname(file).substring(1);
				if (assets[ext]) {
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
	}

	let result = await lightningcss.bundleAsync({
		filename: opts.entry,
		minify: opts.minify ?? false,
		sourceMap: wantSourceMap,
		cssModules: wantModules ? true : undefined,
		targets: resolveTargets(opts.targets),
		resolver,
		inputSourceMap,
	});

	let code = Buffer.isBuffer(result.code) ? result.code : Buffer.from(result.code);
	let map = result.map ? (Buffer.isBuffer(result.map) ? result.map : Buffer.from(result.map)) : undefined;

	let deps = normalizeDependencies(result.dependencies);
	for (let d of loaderDeps) {
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
