import { existsSync } from 'node:fs';
import { parse, resolve, dirname } from 'node:path';
import type { Plugin } from 'rolldown';

/**
 * Locate/auto-resolve files with .ts/.js extensions
 */
export const resolve_plugin: Plugin = {
	name: 'resolve',
	resolveId(file, importer) {
		if (!importer) return null;

		let { ext } = parse(file);
		if (ext) return file;

		let next = resolve(dirname(importer), file);
		if (existsSync(next)) return next;

		let tmp: string;
		if (existsSync(tmp = next + '.ts')) return tmp;
		if (existsSync(tmp = next + '.js')) return tmp;

		return null;
	}
};

export const plugins: Plugin[] = [resolve_plugin];
