// @ts-check
const fs = require('fs/promises');
const exists = require('fs').existsSync;
const { dirname, join, relative } = require('path');
const tempura = require('tempura');

const outdir = join(__dirname, 'output123');

const src = join(__dirname, 'demo123');
// const src = join(__dirname, 'example');

const assets = join(src, 'assets');
const layouts = join(src, 'layouts');
const content = join(src, 'content');

const partials = join(layouts, 'partials');
const shortcodes = join(layouts, 'shortcodes');

/**
 * @typedef {tempura.Blocks} Blocks
 * @typedef {Map<string, tempura.Compiler>} Cache
 * @typedef {(abs: string, rel: string, name: string) => any} Callback
 */

// ---
/** @type {Blocks} */ const Custom = {};
/** @type {Cache}  */ const Layouts = new Map;
/** @type {Cache}  */ const Partials = new Map;
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

const $assets = {
	load(filename) {
		let file = join(assets, filename);
		console.log('~> asset', file);
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
			return 'TODO: style';
		},
		async script(args) {
			console.log('#SCRIPT', args);
			return 'TODO: script';
		}
	}
}

/**
 * @param {string} file
 * @param {string} content
 */
async function write(file, content) {
	let dir = dirname(file);
	exists(dir) || await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(file, content);
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
		// console.log('>~ here', dirent);
		return name.endsWith('.hbs') && callback(abs, rel, name);
	});
}

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

	// TODO: swap on extension:
	// 	 md  ~> compile(md) + html
	// 	 hbs  ~> compile(md) + html
	//   html  ~> static html
	//   ...custom?
	//   others -> copy
	await ls(content, async (input, rel, name) => {
		let idx = rel.lastIndexOf('.');
		let path = '/' + rel.substring(0, idx);

		idx = name.lastIndexOf('.');
		name = name.substring(0, idx);

		// lookup priority
		let files = ['index.hbs', 'html.hbs'];
		if (name !== 'index') files.splice(0, 1, `${name}.hbs`, 'single.hbs');
		let dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat('defaults');

		/** @type {tempura.Compiler|void} */
		let render, layout='', i=0, j=0;
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

		let content = await fs.readFile(input, 'utf8');

		// TODO: markdown -> html first
		// TODO: frontmatter (url/pathname change, $page.params)
		let output = join(outdir, path.substring(1), 'index.html');

		/**
		 * @type {import('.').Variables.Page}
		 */
		let $page = {
			path: path,
			url: new URL(path, $site.url).href,
			content: content,
			// ...frontmatter
		};

		content = await render({ $site, $assets, $page, $utils }, Custom);

		if (!layout.endsWith('html.hbs')) {
			console.log('AGAIN');
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
})
