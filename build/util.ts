import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { builtinModules, createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { rolldown } from 'rolldown';

import { plugins } from './plugins';
import { size } from './size';

import type { OutputOptions } from 'rolldown';

const require = createRequire(import.meta.url);
const packages = join(import.meta.dirname, '../packages');

const isDEV = process.argv.includes('--dev');

const output: OutputOptions = {
	format: 'cjs',
	file: '~inject~',
	esModule: false,
	minify: !isDEV,
};

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

		let { code } = result.output[ 0 ];
		let outfile = join(dir, 'index.js');

		let txt = outfile + ' :: ' + size(code.length);
		txt += '  (' + size(gzipSync(code).length) + ')';

		console.log('~>', txt);

		// bongo package: also emit the browser-targeted client bundle.
		if (dir === 'bongo') {
			await buildClient(abs, dir);
		}

		// plugin.markdown: also emit the highlight subpath module.
		if (dir === 'plugin.markdown') {
			let hb = await rolldown({
				input: join(abs, 'src/highlight.ts'),
				plugins, external,
			});
			try {
				let hr = await hb.write({ ...output, file: join(abs, 'highlight.js') });
				let { code } = hr.output[ 0 ];
				let txt = join(dir, 'highlight.js') + ' :: ' + size(code.length);
				txt += '  (' + size(gzipSync(code).length) + ')';
				console.log('~>', txt);
			} finally {
				await hb.close();
			}
		}
	} catch (err: unknown) {
		let msg = ((err as { message?: string }).message || String(err) || 'Unknown error').replace(/(\r?\n)/g, '$1      ');
		console.error('[ERROR]', msg);
		process.exit(1);
	}
}

async function buildClient(abs: string, dir: string): Promise<void> {
	let bundle = await rolldown({
		input: join(abs, 'src/client/index.ts'),
		plugins,
		// No Node built-ins — this is a pure-browser bundle.
		external: [],
	});

	let result = await bundle.write({
		format: 'esm',
		file: join(abs, 'client.js'),
		minify: !process.argv.includes('--dev'),
	});

	let { code } = result.output[ 0 ];
	let outfile = join(dir, 'client.js');

	let txt = outfile + ' :: ' + size(code.length);
	txt += '  (' + size(gzipSync(code).length) + ')';

	console.log('~>', txt);
}
