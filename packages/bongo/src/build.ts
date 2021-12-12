import { extname, join, relative } from 'path';

import * as fs from './utils/fs';
import * as log from './utils/log';
import { load } from './utils/config';
import * as views from './utils/views';
import { normalize } from './utils/argv';
import { RELOAD } from './utils/http';

import type { Argv, Template } from 'bongo';

export async function build(argv: Argv): Promise<void> {
	normalize(argv);

	const config = await load(argv.cwd);
	const { $site, $assets:ASSETS } = config;
	const debug = argv.debug ? log.debug : () => {};

	debug('[build.argv]', argv);

	await fs.rmdir(argv.dest);

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
	const isPage = /(hbs|html?)$/;
	const { dest, content } = argv;

	await fs.list(content, async (input, rel, name) => {
		let idx = rel.lastIndexOf('.');
		let path = '/' + rel.substring(0, idx);
		let output = join(dest, rel);

		idx = name.lastIndexOf('.');
		let ext = name.substring(idx + 1);
		let basename = name.substring(0, idx);
		let params: Template.Params = {};

		let render: Template.Compiler | void;
		let layout='', content='';

		// TODO: if `index` then defer for last
		// TODO: collect non-`index` pages for "$section" (?)
		if (isPage.test(ext)) {
			content = await fs.read(input, 'utf8');
			let [idx, metadata] = views.frontmatter(content);

			if (idx > 0) {
				Object.assign(params, metadata);
				content = content.substring(idx);
			}

			if (ext === 'hbs') {
				console.log('[TODO] compile "*.hbs" content');
			}
		} else if (ASSETS[ext]) {
			let loader, filename = input;
			let prev, data = new Uint8Array(
				await fs.read(input)
			) as Uint8Array | string;

			debug('[content.loader]', ext, '~> found');

			while (prev !== ext) {
				if (isPage.test(ext)) break;

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
				debug('[content.looper]', prev, '~>', ext);
			}

			if (isPage.test(ext)) {
				content = typeof data === 'string' ? data : new TextDecoder().decode(data);
			} else {
				return fs.write(output, data);
			}
		} else {
			debug('[content.loader]', ext, '~> unknown');
			return fs.copy(input, output);
		}

		if (typeof params.url === 'string') {
			path = '/' + params.url.replace(/^.?\/+/, '');
			if (/^(https?:)?\/\//.test(path)) {
				throw new Error('Custom `url` must be path only');
			}
		}

		if (basename === 'index') {
			path = path.substring(0, path.length - 5);
		} else if (!path.endsWith('/')) {
			path += '/'; // ensure trailing
		}

		output = join(dest, path, 'index.html');

		let $page: Template.Page = {
			path, params, content,
			url: new URL(path, $site.url).href,
			summary: (params.summary as string) || '',
			title: (params.title as string) || '',
			scripts: '',
			styles: '',
		};

		// lookup priority –> need "" for `/layouts/*` root
		let i=0, dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat('');

		if (isPage.test(ext)) {
			let j=0, files = ['index.hbs', 'html.hbs'];
			if (basename !== 'index') {
				files.splice(0, 1, `${basename}.hbs`, 'single.hbs');
			}

			outer: for (; i < dirs.length; i++) {
				for (j=0; j < files.length; j++) {
					layout = join(dirs[i], files[j]);
					render = Layouts.get(layout);
					debug('[content.layout]', rel, '~>', layout);
					if (render) break outer;
				}
			}

			// Should always be defined as a fallback
			if (!render) throw new Error('Missing "html.hbs" template');
			content = await render({ $page, ...config });
		}

		if (!layout.endsWith('html.hbs')) {
			$page.content = content;
			for (i=0; i < dirs.length; i++) {
				layout = join(dirs[i], 'html.hbs');
				render = Layouts.get(layout);
				debug('[content.layout]', rel, '~>', layout);
				if (render) break;
			}
			// Should always be defined as a bare minimum
			if (!render) throw new Error('Missing "html.hbs" template');
			content = await render({ $page, ...config });
		}

		if (argv.dev) {
			content += `<script>`;
			content += `var es = new EventSource('${RELOAD}');`;
			content += `es.onopen = () => console.log('[dev] live reload enabled');`;
			content += `es.onmessage = () => location.reload();`;
			content += `</script>`;
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
			console.error('Visit ~https://github.com/tdewolff/minify~ for installation instructions.');
			return process.exit(1);
		}

		let cwd = process.cwd();
		let input = relative(cwd, argv.dest);
		console.log('~> compressing...', input);
		let output = relative(cwd, argv.cwd) || '.';
		await exec(`minify -r "${input}" -o "${output}"`);
	}

	console.log('~> DONE~!');
}
