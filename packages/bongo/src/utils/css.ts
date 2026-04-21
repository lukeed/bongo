import * as lightningcss from 'lightningcss';
import browserslist from 'browserslist';

export type Targets = string | string[] | lightningcss.Targets;

export type BundleOptions = {
	entry: string;
	targets?: Targets;
	minify?: boolean;
	sourceMap?: 'inline' | false;
	cssModules?: boolean;
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
		return lightningcss.browserslistToTargets(browserslist(input));
	}
	return input;
}

function mapExports(exp: unknown): Record<string, string> | undefined {
	if (!exp || typeof exp !== 'object') return undefined;
	let out: Record<string, string> = {};
	for (let [k, v] of Object.entries(exp as Record<string, { name: string }>)) {
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

	let result = await lightningcss.bundleAsync({
		filename: opts.entry,
		minify: opts.minify ?? false,
		sourceMap: wantSourceMap,
		cssModules: wantModules ? true : undefined,
		targets: resolveTargets(opts.targets),
	});

	let code = Buffer.isBuffer(result.code) ? result.code : Buffer.from(result.code);
	let map = result.map ? (Buffer.isBuffer(result.map) ? result.map : Buffer.from(result.map)) : undefined;

	let out: BundleResult = {
		code: wantSourceMap && map ? inlineSourceMap(code, map) : code,
		dependencies: normalizeDependencies(result.dependencies),
	};

	if (!wantSourceMap && map) out.map = map;

	let exports = mapExports(result.exports);
	if (exports) out.exports = exports;

	return out;
}
