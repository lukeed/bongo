import * as fs from './utils/fs';
import { load } from './utils/config';
import * as views from './utils/views';
import { normalize } from './utils/argv';
import { extname, join, relative } from 'path';

import type { Argv, Template } from 'ssg';
import type { Compiler } from './utils/tempura';

export async function build(argv: Argv) {
	normalize(argv);
	console.log(argv);

	const config = await load(argv.cwd);
	const { $site, $assets:ASSETS } = config;

	await fs.rmdir(argv.dest, { recursive: true });

	config.$assets = {
		// @ts-ignore -> switcheroo
		load(filename: string, encoding?: BufferEncoding) {
			let file = join(argv.assets, filename);
			fs.assert(file, `Missing "${filename}" asset!`);
			return fs.read(file, encoding);
		}
	};

	// sets `views` caches
	await views.collect(argv, config);

	const { Layouts } = views;
	const { dest, content } = argv;

	await fs.list(content, async (input, rel, name) => {
		let idx = rel.lastIndexOf('.');
		let path = '/' + rel.substring(0, idx);
		let output = join(dest, rel);

		idx = name.lastIndexOf('.');
		let ext = name.substring(idx + 1);
		let basename = name.substring(0, idx);
		let params: Template.Params = {};

		let render: Compiler | void;
		let layout='', content='';

		if (ext === 'hbs') {
			// do nothing
		} else if (ASSETS[ext]) {
			let loader, filename = input;
			let prev, rgx = /(hbs|html?)$/;
			let data = new Uint8Array(
				await fs.read(input)
			) as Uint8Array | string;

			while (prev !== ext) {
				if (rgx.test(ext)) break;

				// TODO: ASSETS after config
				// TODO: loader receives utils
				if (loader = ASSETS[prev = ext]) {
					let result = await loader(filename, data);
					filename = result.filename;
					data = result.content;
					if (result.metadata) {
						Object.assign(params, result.metadata);
					}
				}

				ext = extname(filename).substring(1);
			}

			if (rgx.test(ext)) {
				content = typeof data === 'string' ? data : new TextDecoder().decode(data);
			} else {
				return fs.write(output, data);
			}
		} else {
			// TODO: print "no match" if debug
			return fs.copy(input, output);
		}

		if (typeof params.url === 'string') {
			path = '/' + params.url.replace(/^.?\/+/, '');
			if (/^(https?:)?\/\//.test(path)) {
				throw new Error('Custom `url` must be path only');
			}
		}

		let $page: Template.Page = {
			path: path,
			url: new URL(path.substring(1), $site.url).href,
			content: content,
			params: params,
		};

		// lookup priority
		let i=0, dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat('defaults');
		output = join(dest, path.substring(1), 'index.html');

		if (ext === 'hbs') {
			let j=0, files = ['index.hbs', 'html.hbs'];
			if (basename !== 'index') files.splice(0, 1, `${basename}.hbs`, 'single.hbs');

			outer: for (; i < dirs.length; i++) {
				for (j=0; j < files.length; j++) {
					layout = join(dirs[i], files[j]);
					render = Layouts.get(layout);
					// TODO: --debug log order
					if (render) break outer;
				}
			}

			// Should always be defined as a fallback
			if (!render) throw new Error('Missing "defaults/html.hbs" template');
			content = await render({ $page, ...config });
		}

		if (!layout.endsWith('html.hbs')) {
			$page.content = content;
			for (i=0; i < dirs.length; i++) {
				layout = join(dirs[i], 'html.hbs');
				render = Layouts.get(layout);
				// TODO: --debug log order
				if (render) break;
			}
			// Should always be defined as a bare minimum
			if (!render) throw new Error('Missing "defaults/html.hbs" template');
			content = await render({ $page, ...config });
		}

		// console.log('~> output', { output, params });
		await fs.write(output, content);
	});

	if (argv.minify) {
		const exec = require('util').promisify(
			require('child_process').exec
		);

		try {
			let { stdout, stderr } = await exec('minify --version');
			if (stderr.length || stdout.length < 1) throw 1;
		} catch (err) {
			// TODO: formatting
			console.error('You must have `minify` available in your $PATH for `--minify` to work.');
			return process.exitCode = 1;
		}

		let input = relative(argv.cwd, argv.dest);
		console.log('~> compressing...', input);
		await exec(`minify -r "${input}" -o .`);
	}

	console.log('~> DONE~!');
}
