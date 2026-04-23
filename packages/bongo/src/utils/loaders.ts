import { extname } from 'node:path';

import type { Loader } from 'bongo';

export type LoaderMap = Record<string, Loader>;

export type RunResult = {
	filename: string;
	content: Uint8Array | string;
	metadata: Loader.Metadata;
	// Last non-null sourcemap emitted by the chain. Loader chains that rename
	// across multiple steps produce intermediate maps that are not composed
	// here — consumers get the most recent map (against the final output).
	sourcemap?: Loader.SourceMap;
};

export type RunOptions = {
	// Predicate to stop the chain early without consulting a loader for the
	// current extension. Used by the content pipeline to hand off .hbs/.html
	// files to the template walker even when a loader exists for them.
	isTerminal?: (ext: string) => boolean;
};

// Walk the loader chain for `filename`, driven by its extension. Each loader
// may rename the filename (changing the extension); the loop continues until
// the extension stops changing, no loader exists for the current extension,
// or the caller's `isTerminal` predicate says to stop.
export async function run(
	filename: string,
	content: Uint8Array | string,
	assets: LoaderMap,
	utils: Loader.Utilities,
	opts: RunOptions = {},
): Promise<RunResult> {
	let metadata: Loader.Metadata = {};
	let sourcemap: Loader.SourceMap | undefined;
	let ext = extname(filename).substring(1);
	let prev: string | undefined;

	while (prev !== ext) {
		if (opts.isTerminal?.(ext)) break;

		let loader = assets[ext];
		if (!loader) break;
		prev = ext;

		let result = await loader(filename, content, utils);
		filename = result.filename;
		content = result.content;
		if (result.metadata) Object.assign(metadata, result.metadata);
		if (result.sourcemap != null) sourcemap = result.sourcemap;

		ext = extname(filename).substring(1);
	}

	let out: RunResult = { filename, content, metadata };
	if (sourcemap != null) out.sourcemap = sourcemap;
	return out;
}

// Normalise a loader-produced sourcemap into a JSON string suitable for
// tools like lightningcss's `inputSourceMap`. Returns null if the map is
// absent or can't be serialised.
export function serializeMap(map: Loader.SourceMap | null | undefined): string | null {
	if (map == null) return null;
	if (typeof map === 'string') return map;
	try {
		return JSON.stringify(map);
	} catch {
		return null;
	}
}
