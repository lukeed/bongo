import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { builtinModules } from 'node:module';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import type { OutputOptions } from 'rolldown';

import { plugins } from './plugins';

const require = createRequire(import.meta.url);
const packages = join(import.meta.dirname, '../packages');

const isDEV = process.argv.includes('--dev');

const output: OutputOptions = {
	format: 'cjs',
	file: '~inject~',
	esModule: false,
	minify: !isDEV,
};

const UNITS = ['B ', 'kB', 'MB', 'GB'];

function size(val = 0): string {
	if (val < 1e3) return `${val} ${UNITS[0]}`;
	let exp = Math.min(Math.floor(Math.log10(val) / 3), UNITS.length - 1) || 1;
	let out = (val / Math.pow(1e3, exp)).toPrecision(3);
	let idx = out.indexOf('.');
	if (idx === -1) out += '.00';
	else if (out.length - idx - 1 !== 2) {
		out = (out + '00').substring(0, idx + 3);
	}
	return out + ' ' + UNITS[exp];
}

export function list(): Promise<string[]> {
	return readdir(packages);
}

export async function build(dir: string): Promise<void> {
	try {
		let abs = join(packages, dir);
		let pkg = require(join(abs, 'package.json'));

		let external = [
			...builtinModules,
			...Object.keys(pkg.dependencies || {}),
			...Object.keys(pkg.peerDependencies || {}),
			...Object.keys(pkg.optionalDependencies || {}),
		].map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/.*)?$`));

		let bundle = await rolldown({
			input: join(abs, 'src/index.ts'),
			plugins, external,
		});

		let result = await bundle.write({
			...output, file: join(abs, 'index.js')
		});

		let { code } = result.output[0];
		let outfile = join(dir, 'index.js');

		let txt = outfile + ' :: ' + size(code.length);
		txt += '  (' + size(gzipSync(code).length) + ')';

		console.log('~>', txt);
	} catch (err: any) {
		let msg = (err.message || err || 'Unknown error').replace(/(\r?\n)/g, '$1      ');
		console.error('[ERROR]', msg);
		process.exit(1);
	}
}
