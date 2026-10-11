import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { exports, legacy } from 'resolve.exports';

import * as fs from './fs';

const SPECIFIER = /^(@[^/]+\/[^./][^/]*|[^@./][^/]*)(\/.+)?$/;

/**
 * The stylesheet that a bare CSS `@import` names, from the nearest `node_modules/<name>` above `from`, with symlinks resolved.
 * It takes the first file of: a `.css` target in `exports` under the `style`, `import`, or `require` condition (each with `default`),
 * then the `style` field, then the subpath as a file in the package.
 * @example stylesheet('@twinkleplop/theme-github/dark', '/site/assets/style.css') //=> '/site/node_modules/@twinkleplop/theme-github/dist/dark.css'
 */
export function stylesheet(specifier: string, from: string): string | undefined {
	let [, name, subpath] = SPECIFIER.exec(specifier) || [];
	if (!name) return;

	let dir = dirname(from);
	while (!fs.exists(join(dir, 'node_modules', name))) {
		if (dir === dirname(dir)) return;
		dir = dirname(dir);
	}

	let root = join(dir, 'node_modules', name);
	let file = join(root, 'package.json');
	try {
		var pkg: unknown = fs.exists(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
	} catch (err) {
		throw new Error(`Invalid JSON in ${file}`, { cause: err });
	}
	if (!pkg || typeof pkg !== 'object') throw new Error(`Invalid ${file}: expected an object`);

	let entry = subpath ? '.' + subpath : '.';
	let targets: string[] = ['style', 'import', 'require'].flatMap(condition => {
		try {
			return exports(pkg, entry, { unsafe: true, conditions: [condition] }) || [];
		} catch {
			// resolve.exports throws when no export matches
			return [];
		}
	}).filter(target => target.endsWith('.css'));

	let fallback = subpath ? entry : legacy(pkg, { browser: false, fields: ['style'] });
	if (fallback) targets.push(fallback);

	for (let target of targets) {
		let path = join(root, target);
		if (fs.isFile(path)) return realpathSync(path);
	}
}
