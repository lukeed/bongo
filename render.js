// @ts-check
const fs = require('fs/promises');
const exists = require('fs').existsSync;
const { dirname, extname, join, relative } = require('path');
const tempura = require('tempura');

const srcdir = join(__dirname, 'demo123');
// const srcdir = join(__dirname, 'example');
const outdir = join(__dirname, 'output123');

const assets = join(srcdir, 'assets');
const layouts = join(srcdir, 'layouts');
const content = join(srcdir, 'content');

const partials = join(layouts, 'partials');
const shortcodes = join(layouts, 'shortcodes');

/**
 * @typedef {tempura.Blocks} Blocks
 * @typedef {Map<string, tempura.Compiler>} Cache
 * @typedef {Record<string, Promise<string>>} AssetCache
 * @typedef {(abs: string, rel: string, name: string) => any} Callback
 */

// ---
/** @type {Blocks} */ const Custom = {};
/** @type {Cache} */ const Layouts = new Map;
/** @type {Cache} */ const Partials = new Map;
/** @type {AssetCache} */ const Assets = {};
// ---

/**
 * @type {import('.').Variables.Site}
 */
const $site = {
	url: 'https://lukeed.com',
	lang: 'en',
	title: 'Luke Edwards',
	description: 'My website',
};

const $utils = {
	/**
	 * @param {string} text
	 * @param {number} length
	 * @returns {string}
	 */
	truncate(text, length) {
		return (text || '').substring(0, length);
	},
	/**
	 * @param {string} text
	 * @returns {number}
	 */
	countwords(text) {
		return text.split(/\s+/g).length;
	},
	url: {
		/**
		 * @param {string} to
		 * @param {string} [fro]
		 */
		abs(to, fro = $site.url) {
			return new URL(to, fro).pathname;
		}
	},
	date: {
		/**
		 * @param {string|number|Date} value
		 * @param {string} format
		 * @returns {string}
		 */
		format(value, format) {
			let d = new Date(value);
			return d.toISOString();
		}
	}
};

/**
 * @type {import('esbuild').build}
 */
let esbuild;

const $assets = {
	/**
	 * @param {string} filename
	 * @param {import('fs').EncodingOption} [encoding]
	 * @returns {Promise<string|Buffer>}
	 */
	load(filename, encoding) {
		let file = join(assets, filename);
		if (exists(file)) return fs.readFile(file, encoding);
		throw new Error(`Missing "${filename}" asset!`);
	}
};

/** @type {tempura.Options} */
const options = {
	async: true,
	props: ['$site', '$page', '$assets', '$utils'],
	blocks: {
		async partial(args) {
			let { src, ...rest } = args;
			// NOTE: partials do not have access to `$page` !!
			let render = Partials.get(src) || Partials.get(src + '.hbs');
			if (!render) throw new Error(`Unknown "${src}" partial!`);
			return await render(rest);
		},
		async style(args) {
			esbuild = esbuild || require('esbuild').build;
			return 'TODO: style';
		},
		async script({ src, target, format, async, defer, inline }) {
			esbuild = esbuild || require('esbuild').build;

			// TODO: track references
			// if `inline` 2+ count, hoist to external

			let file = join(assets, src);

			let output = Assets[file] || '';
			if (output) return await output;

			// TODO: collect all inputs for build for code splitting reuse
			if (!exists(file)) {
				throw new Error(`Missing "assets/${src}" file!`);
			}

			// outbase?
			// chunkNames
			// assetNames

			/** @type {import('esbuild').BuildOptions} */
			let options = {
				bundle: true,
				outdir: outdir,
				splitting: true,
				entryPoints: [file],
				// absWorkingDir: srcdir,
				target: target || 'es2017',
				format: format || 'esm',
				resolveExtensions: ['.ts', '.js', '.cjs', '.mjs', '.css', '.json'],
				mainFields: ['browser', 'module', 'jsnext', 'main'],
				conditions: ['browser', 'import', 'production'],
				platform: 'neutral',
				incremental: false, // TODO
				sourcemap: false, // TODO
				minify: true, // TODO
				publicPath: new URL($site.url).pathname,
				metafile: true,
			};

			if (inline) {
				options.write = false;
			} else {
				options.allowOverwrite = options.write = true;
				options.entryNames = options.chunkNames = '[name].[hash]';
				// if (output = 'r.js') options.outfile = join(outdir, output);
			}

			Assets[file] = new Promise((res, rej) => {
				return esbuild(options).then(result => {
					// TODO: errors, warnings
					// TODO: track `result.metafile.inputs[key].imports`

					// esbuild returns all cwd-relative
					let entry = relative(process.cwd(), file);

					let key, tmp, outfile='';
					for (key in result.metafile.outputs) {
						tmp = result.metafile.outputs[key];
						if (tmp.entryPoint === entry) {
							outfile = key;
							break;
						}
					}

					if (outfile) {
						outfile = relative(outdir, outfile);
						outfile = $utils.url.abs(outfile);
					} else {
						return rej(`Missing output for "${src}" entrypoint`);
					}

					// begin construction
					output = '<script';
					if (async) output += ' async';
					if (!format || format === 'esm') {
						output += ' type=module';
					} else if (defer) {
						output += ' defer';
					}

					if (inline) {
						tmp = result.outputFiles.shift();
						output += '>' + tmp.text + '</script>';

						// all others are chunks, write to disk
						Promise.all(result.outputFiles.map(obj => {
							return write(obj.path, obj.contents)
						})).catch(rej);
					} else {
						output += ` src="${outfile}"></script>`;
					}

					return res(output);
				}).catch(rej);
			});

			return await Assets[file];
		}
	}
}

// options.blocks.script.setup = (...args) => console.log('SCRIPT.SETUP', args);

/**
 * @param {string} file
 * @param {Buffer|Uint8Array|string} content
 */
async function write(file, content) {
	let dir = dirname(file);
	exists(dir) || await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(file, content);
}

/**
 * @param {string} src
 * @param {string} dest
 */
async function copy(src, dest) {
	let dir = dirname(dest);
	exists(dir) || await fs.mkdir(dir, { recursive: true });
	await fs.copyFile(src, dest);
}

/**
 * @param {string} file
 * @param {Blocks} [blocks]
 */
async function compile(file, blocks) {
	try {
		let config = { ...options };
		if (blocks) config.blocks = { ...config.blocks, ...blocks };
		let content = await fs.readFile(file, 'utf8');
		return tempura.compile(content, config);
		// TODO: typescript signature
		// TODO: fix ths return type for Compiler / separate from Block
		// return input => view({ ...input, $site, $utils, $assets }, Custom);
	} catch (err) {
		file = relative(layouts, file);
		let tmp = new Error(`Error compiling "${file}" template!`);
		if (!(err instanceof SyntaxError)) tmp.message += '\n\t'+err.message;
		throw tmp;
	}
}

/**
 * @param {string} dir
 * @param {Callback} callback
 */
async function ls(dir, callback, prefix='') {
	let files = await fs.readdir(dir, {
		withFileTypes: true
	});

	return Promise.all(
		files.map(dirent => {
			let item = join(dir, dirent.name);
			let rel = join(prefix, dirent.name);
			if (dirent.isFile()) return callback(item, rel, dirent.name);
			return /^(shortcode|partial)s$/.test(dirent.name) || ls(item, callback, rel);
		})
	);
}

/**
 * @param {string} dir
 * @param {Callback} callback
 */
async function collect(dir, callback) {
	return ls(dir, (abs, rel, name) => {
		return name.endsWith('.hbs') && callback(abs, rel, name);
	});
}

let mdown;

/**
 * @type {Record<string, import('.').Loader>}
 */
const ASSETS = {
	html(filename, content) {
		console.log('DONT', { filename, content });
		return { filename, content };
	},
	md(input, content) {
		mdown = mdown || require('markdown-it')({
			html: true,
			linkify: true,
			typographer: true
		});

		if (typeof content !== 'string') {
			content = new TextDecoder().decode(content);
		}

		let metadata = {};
		let filename = input + '.html';
		let match = /---\r?\n([\s\S]+?)\r?\n---/.exec(content);

		if (match != null) {
			content = content.substring(match[0].length);
			match[1].split('\n').forEach(pair => {
				let [key, ...v] = pair.split(':');
				metadata[key.trim()] = v.join(':').trim();
			});
		}

		content = mdown.render(content);
		return { filename, content, metadata };
	}
};

(async function () {
	// TODO: grab all first before compiling
	// ~> allows all names to be known upfront
	console.log('~> collect "shortcodes" views');
	await collect(shortcodes, async (abs, rel, name) => {
		let render = await compile(abs);
		let key = name.replace('.hbs', '');
		// NOTE: Shortcodes do NOT have access to `$page` var
		Custom[key] = x => render({ ...x, $site, $utils, $assets }, Custom);
	});

	console.log('~> collect "partials" views');
	await collect(partials, async (abs, rel) => {
		let render = await compile(abs, Custom);
		// NOTE: Partials do NOT have access to `$page` var
		Partials.set(rel, x => render({ ...x, $site, $utils, $assets }, Custom));
	});

	console.log('~> collect "layouts" views');
	await collect(layouts, async (abs, rel) => {
		Layouts.set(rel, await compile(abs, Custom));
	});

	console.log('--- TEMPLATES READY ---');
	console.log('~> Layouts', [ ...Layouts.keys() ]);
	console.log('~> Partials', [ ...Partials.keys() ]);
	console.log('~> Custom', Object.keys(Custom));
	console.log('---');

	await ls(content, async (input, rel, name) => {
		let idx = rel.lastIndexOf('.');
		let path = '/' + rel.substring(0, idx);
		let output = join(outdir, rel);

		idx = name.lastIndexOf('.');
		let ext = name.substring(idx + 1);
		let basename = name.substring(0, idx);

		/** @type {tempura.Compiler|void} */
		let render, layout='';
		let content='', params={};

		if (ext === 'hbs') {
			// do nothing
		} else if (ASSETS[ext]) {
			let loader, filename = input;
			let prev, rgx = /(hbs|html?)$/;
			let data = new Uint8Array(
				await fs.readFile(input)
			);

			while (prev !== ext) {
				if (rgx.test(ext)) break;

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
				output = join(outdir, path.substring(1), 'index.html'); // todo: move down
				content = typeof data === 'string' ? data : new TextDecoder().decode(data);
			} else {
				return write(output, data);
			}
		} else {
			// TODO: print "no match" if debug
			return copy(input, output);
		}

		/**
		 * @type {import('.').Variables.Page}
		 */
		 let $page = {
			path: path,
			url: new URL(path, $site.url).href,
			content: content,
			params: params,
			// ...frontmatter
		};

		// lookup priority
		let i=0, dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat('defaults');

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
			content = await render({ $site, $assets, $page, $utils }, Custom);
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
			content = await render({ $site, $assets, $page, $utils }, Custom);
		}

		console.log('~> output', {output, params});

		// console.log('~> content', { input, path, output, content });
		await write(output, content);
	});

	console.log('~> done~!');

	if ('TODO: --minify') {
		const exec = require('util').promisify(
			require('child_process').exec
		);

		try {
			let { stdout, stderr } = await exec('minify --version');
			if (stderr.length || stdout.length < 1) throw 1;
		} catch (err) {
			// TODO: formatting
			console.error('You must have `minify` available in your $PATH for `--minify` to work.');1
			return process.exitCode = 1;
		}

		let cwd = process.cwd(); // TODO
		let input = relative(cwd, outdir);
		console.log('~> compressing...', input);
		await exec(`minify -r "${input}" -o .`);
		console.log('~> DONE~!');
	}
})().catch(err => {
	console.error(err.stack);
	process.exit(1);
});
