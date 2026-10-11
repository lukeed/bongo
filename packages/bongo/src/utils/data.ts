import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

import { loadModule } from './config';
import * as fs from './fs';
import * as yaml from './yaml';

export type Data = Record<string, unknown>;

export type Loaded = {
	value: Data;
	/** Every file the data came from, to watch in dev. */
	files: string[];
};

type Entry = { name: string; keys: string[]; value: unknown; files: string[] };
type Owner = { name: string; branch?: Data };

const MODULES = ['.ts', '.mts', '.js', '.mjs', '.cjs'];
const EXTENSIONS = ['.json', '.yaml', '.yml', ...MODULES];

function freeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

function set(target: Data, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

async function read(file: string, ext: string, root: string): Promise<Omit<Entry, 'name' | 'keys'>> {
	if (MODULES.includes(ext)) {
		let mod = await loadModule(file, root);
		if (!('default' in mod.exports)) throw new Error('expected a default export');
		return { value: mod.exports.default, files: mod.files };
	}
	let text = await readFile(file, 'utf8');
	return { value: freeze(ext === '.json' ? JSON.parse(text) : yaml.parse(text)), files: [file] };
}

/**
 * Load every file under `dir` into one object, keyed by its path without the extension.
 * JSON and YAML values are frozen; modules give their default export.
 * @example (await load('site/data')).value.oss //=> { history: [...] }, from data/oss/history.json
 */
export async function load(dir: string): Promise<Loaded> {
	if (!fs.exists(dir)) return { value: {}, files: [] };

	let label = basename(dir);
	let rels = (await readdir(dir, { recursive: true, withFileTypes: true }))
		.filter(dirent => !dirent.isDirectory())
		.map(dirent => relative(dir, join(dirent.parentPath, dirent.name)))
		.filter(rel => !rel.split(sep).some(part => part.startsWith('.')))
		.sort();

	let entries: Entry[] = await Promise.all(rels.map(async rel => {
		let name = join(label, rel);
		let ext = extname(rel);
		if (!EXTENSIONS.includes(ext)) {
			throw new Error(`${name}: unsupported data file; use ${EXTENSIONS.slice(0, -1).join(', ')}, or ${EXTENSIONS.at(-1)}`);
		}
		try {
			var loaded = await read(join(dir, rel), ext, dirname(dir));
		} catch (err) {
			throw new Error(`${name}: ${err instanceof Error ? err.message : err}`, { cause: err });
		}
		return { name, keys: rel.slice(0, -ext.length).split(sep), ...loaded };
	}));

	let value: Data = {};
	let owners = new Map<string, Owner>();

	for (let entry of entries) {
		let node = value;
		entry.keys.forEach((key, idx) => {
			let path = entry.keys.slice(0, idx + 1);
			let leaf = idx === entry.keys.length - 1;
			let owner = owners.get(path.join('/'));
			if (owner && (leaf || !owner.branch)) {
				throw new Error(`${owner.name} and ${entry.name} both define $data.${path.join('.')}`);
			}
			if (leaf) {
				owners.set(path.join('/'), { name: entry.name });
				return set(node, key, entry.value);
			}
			let branch = owner?.branch ?? {};
			if (!owner) {
				owners.set(path.join('/'), { name: entry.name, branch });
				set(node, key, branch);
			}
			node = branch;
		});
	}

	for (let { branch } of owners.values()) {
		if (branch) Object.freeze(branch);
	}

	return { value: Object.freeze(value), files: entries.flatMap(entry => entry.files) };
}
