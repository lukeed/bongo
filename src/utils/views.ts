import { join, relative } from 'path';
import * as tempura from 'tempura';
import * as fs from './fs';

import type { Argv } from 'ssg';
import type { BuildOptions } from 'esbuild';

// /** @type {AssetCache} */ const Assets = {};

type Cache = Map<string, tempura.Compiler>;
// @typedef {Record<string, Promise<string>>} AssetCache

export const Partials: Cache = new Map;
export const Layouts: Cache = new Map;

let esbuild: typeof import('esbuild').build;

export async function collect(argv: Required<Argv>): Promise<void> {
	let extn = /\.hbs$/i;
	let { layouts } = argv;
	let blocks: tempura.Blocks = {
		partial(args) {
			// NOTE: partials do not have access to `$page` !!
			let { src, ...rest } = args as Record<string, string>;
			let render = Partials.get(src) || Partials.get(src + '.hbs');

			if (render) return render(rest);
			throw new Error(`Unknown "${src}" partial!`);
		},
		async script() {
			//
		}
	};

	let props = ['$site', '$page', '$assets', '$utils'];
	let options: tempura.Options = { async: true, props, blocks };

	async function compile(file: string) {
		try {
			let content = await fs.read(file, 'utf8');
			return tempura.compile(content, options);
		} catch (err) {
			file = relative(layouts, file);
			let tmp = new Error(`Error compiling "${file}" template!`);
			if (!(err instanceof SyntaxError)) tmp.message += '\n\t'+err.message;
			throw tmp;
		}
	}

	console.log('~> collect "shortcodes" views');
	await fs.list(argv.shortcodes, async (absolute, _, name) => {
		if (!extn.test(name)) return;
		let key = name.replace(extn, '');
		let render = await compile(absolute);
		// NOTE: Shortcodes do NOT have access to `$page` var
		blocks[key] = x => render({ ...x, $site, $utils, $assets }, blocks);
	});

	console.log('~> collect "partials" views');
	await fs.list(argv.partials, async (absolute, rel) => {
		if (!extn.test(rel)) return;
		let render = await compile(absolute);
		// NOTE: Partials do NOT have access to `$page` var
		Partials.set(rel, x => render({ ...x, $site, $utils, $assets }, blocks));
	});

	console.log('~> collect "layouts" views');
	await fs.list(layouts, async (absolute, rel, name) => {
		if (extn.test(name)) Layouts.set(rel, await compile(absolute));
	});
}
