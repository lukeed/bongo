import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { summary, toBuildError } from './bundler';
import * as fs from './fs';
import { publicPath, withExtension } from './tags';

import type { Config } from 'bongo';
import type { ImportKind, Plugin, PluginContext, RolldownBuild } from 'rolldown';
import type { BuildError } from './bundler';

const priority = [
	'bongo.config.ts',
	'bongo.config.mjs',
	'bongo.config.cjs',
	'bongo.config.js',
];

// Packages and builtins, which the runtime resolves; `#imports` and paths are bundled.
const BARE = /^(?![./#\0]|[a-zA-Z]:[\\/]|file:)/;

// Module-relative values keep pointing at each source file, not at the bundled copy.
const META: Record<string, string> = {
	'import.meta.url': '__bongo_url',
	'import.meta.filename': '__bongo_filename',
	'import.meta.dirname': '__bongo_dirname',
	'import.meta.path': '__bongo_filename',
	'import.meta.dir': '__bongo_dirname',
	__filename: '__bongo_filename',
	__dirname: '__bongo_dirname',
};

const meta: Plugin = {
	name: 'bongo:meta',
	transform(code, id) {
		if (!/\.[cm]?[jt]sx?$/.test(id) || !/import\.meta|__dirname|__filename/.test(code)) return null;
		let values = `const __bongo_url = ${JSON.stringify(pathToFileURL(id).href)}, __bongo_filename = ${JSON.stringify(id)}, __bongo_dirname = ${JSON.stringify(dirname(id))};`;
		// prepended on the same line, so line numbers in errors stay true
		return { code: values + code };
	},
};

const NODE_MODULES = /[\\/]node_modules[\\/]/;

// The nearest folder above `file` that has a package.json.
function home(file: string): string {
	let dir = dirname(file);
	while (!fs.exists(join(dir, 'package.json')) && dir !== dirname(dir)) dir = dirname(dir);
	return dir;
}

// bongo stays a package even when it is linked, so only one copy of it runs.
const SELF = home(realpathSync(__filename));

// The node_modules entry of the package that `id` names, as `importer` finds it.
function installed(id: string, importer: string): string | undefined {
	let name = id.split('/').slice(0, id.startsWith('@') ? 2 : 1).join('/');
	for (let dir = dirname(importer); ; dir = dirname(dir)) {
		let entry = join(dir, 'node_modules', name);
		if (fs.exists(entry)) return entry;
		if (dir === dirname(dir)) return;
	}
}

// The real folder of a package entry that is a symlink out of node_modules, like a workspace package.
function link(entry: string): string | undefined {
	if (!lstatSync(entry).isSymbolicLink()) return;
	let real = realpathSync(entry);
	return NODE_MODULES.test(real + sep) ? undefined : real;
}

// The file a package import loads, found as the runtime finds it: Bun's resolver under Bun, else Rolldown's, which follows Node.
async function locate(context: PluginContext, id: string, importer: string, kind: ImportKind): Promise<string | undefined> {
	if (typeof Bun !== 'undefined') {
		try {
			var file = Bun.resolveSync(id, dirname(importer));
		} catch {
			return;
		}
	} else {
		let found = await context.resolve(id, importer, { kind, skipSelf: true });
		if (!found || !fs.exists(found.id)) return;
		file = found.id;
	}
	return realpathSync(file);
}

// Packages stay external, except a linked one (like a workspace package), which is local code: bundled, watched, and run fresh.
function packages(): Plugin {
	let roots: string[] = [];
	return {
		name: 'bongo:packages',
		async resolveId(id, importer, options) {
			if (!importer || !BARE.test(id)) return null;
			if (isBuiltin(id) || id.startsWith('bun:')) return { id, external: true };

			let entry = installed(id, importer);
			if (!entry) {
				// no package has the name, so a tsconfig `paths` alias can map it to local code
				let found = await this.resolve(id, importer, { kind: options.kind, skipSelf: true });
				if (found && !found.external && !NODE_MODULES.test(found.id)) return found.id;
			}

			let root = entry && link(entry);
			if (root && root !== SELF) {
				let file = await locate(this, id, importer, options.kind);
				if (file && file.startsWith(root + sep) && !file.endsWith('.node')) {
					roots.push(root);
					return file;
				}
			}

			if (!roots.some(dir => importer.startsWith(dir + sep))) return { id, external: true };
			let file = await locate(this, id, importer, options.kind);
			if (!file) return { id, external: true };
			return { id: options.kind === 'require-call' ? file : pathToFileURL(file).href, external: true };
		},
	};
}

// Next to the nearest node_modules, bare imports resolve as they do from the source file.
function scratch(file: string): string {
	for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
		let modules = join(dir, 'node_modules');
		if (fs.exists(modules)) return join(modules, '.bongo');
	}
	return tmpdir();
}

// Every file the bundle loaded, including modules that tree-shaking dropped from its output.
async function read(bundle: RolldownBuild, file: string): Promise<string[]> {
	return [...new Set([file, ...(await bundle.watchFiles).filter(id => !id.startsWith('\0'))])];
}

export type Module = {
	exports: Record<string, unknown>;
	/** The local files the module read, itself included. */
	files: string[];
};

/**
 * A module that failed to bundle or to run.
 * `error` locates the failure and `files` lists the local files read so far, to watch for a fix.
 */
export class LoadError extends Error {
	error: BuildError;
	files: string[];

	constructor(error: BuildError, files: string[], root: string, cause: unknown) {
		super(summary(error, root), { cause });
		this.name = 'LoadError';
		this.error = error;
		this.files = files;
	}
}

/**
 * Import `file` as fresh code: Rolldown bundles it and its local imports into one temporary module,
 * which is imported once and deleted. Packages stay external and resolve as usual,
 * except packages linked from outside node_modules, which are local code and are bundled too.
 * Errors name places relative to `root`.
 * @example let { exports, files } = await loadModule('/site/bongo.config.ts');
 */
export async function loadModule(file: string, root = dirname(file)): Promise<Module> {
	let rd = await import('rolldown');
	let bundle = await rd.rolldown({
		input: file,
		platform: 'node',
		transform: { define: META },
		plugins: [packages(), meta],
	});

	try {
		var { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
		var files = await read(bundle, file);
	} catch (err) {
		throw new LoadError(toBuildError(err, file), await read(bundle, file), root, err);
	} finally {
		await bundle.close();
	}

	let [chunk] = output;
	let base = scratch(file);

	// a new folder each time: Bun cannot import a file added to a folder it has already read
	await mkdir(base, { recursive: true });
	let dir = await mkdtemp(join(base, `${basename(file)}-`));

	try {
		let temp = join(dir, 'module.mjs');
		await writeFile(temp, chunk.code);
		let exports: Record<string, unknown> = await import(pathToFileURL(temp).href);
		return { exports, files };
	} catch (err) {
		let message = err instanceof Error ? err.message : String(err);
		throw new LoadError({ message, file }, files, root, err);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Traverse upwards until find a config file
 * @NOTE Does not leave `root` directory
 * @modified lukeed/escalade
 */
export async function find(root: string, start: string): Promise<string|void> {
	let i=0, dir = resolve(root, start);
	let files = new Set(await fs.ls(dir));

	for (; i < priority.length; i++) {
		if (files.has(priority[i])) {
			return join(dir, priority[i]);
		}
	}

	dir = dirname(dir);

	if (dir.startsWith(root)) {
		return find(root, dir);
	}
}

/**
 * Merge config objects
 * Overrides default values
 * Priority: rules > plugins
 * @NOTE Mutates `base` object!
 */
export function merge(base: Required<Config>, custom: Partial<Config>) {
	if ('$assets' in custom) {
		throw new Error('`$assets` is now `$loaders`: rename it in your config or plugin');
	}
	if (custom.plugins) {
		custom.plugins.forEach(o => merge(base, o));
	}
	Object.assign(base.$site, custom.$site);
	Object.assign(base.$loaders, custom.$loaders);
	Object.assign(base.$partials, custom.$partials);
	if (custom.$build) {
		let define = custom.$build.define && { ...base.$build.define, ...custom.$build.define };
		Object.assign(base.$build, custom.$build, define && { define });
	}
	if (custom.$images) {
		Object.assign(base.$images, custom.$images);
	}
	let next = custom.$hooks?.transform;
	if (next) {
		let prev = base.$hooks.transform;
		base.$hooks.transform = prev ? async (text, ctx) => next(await prev(text, ctx), ctx) : next;
	}
	for (let key in custom.$utils) {
		if (typeof custom.$utils[key] !== 'object') {
			base.$utils[key] = custom.$utils[key];
		} else {
			base.$utils[key] = Object.assign(base.$utils[key] || {}, custom.$utils[key]);
		}
	}
}

export type Loaded = {
	config: Required<Config>;
	/** The config file and the local files it imports. */
	files: string[];
};

const BLOCK = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// The text of an HTML string: no tags, comments, scripts, or styles; entities decoded; whitespace collapsed.
function plain(html: string): string {
	return (html || '')
		.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
		.replace(BLOCK, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (all, dec, hex, name) => {
			if (name) return ENTITIES[name.toLowerCase()] ?? all;
			let code = parseInt(dec || hex, dec ? 10 : 16);
			return code <= 0x10FFFF ? String.fromCodePoint(code) : all;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

// An Intl.DateTimeFormat is slow to make, so `$utils.date.format` keeps the ones it made; content can choose the options, so it keeps at most this many.
const FORMATS_MAX = 100;
const FORMATS: Map<string, Intl.DateTimeFormat> = new Map();

function formatter(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	let key = JSON.stringify([lang, Object.entries(options).sort(([a], [b]) => a < b ? -1 : 1)]);
	let hit = FORMATS.get(key);
	if (hit) return hit;
	let made = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...options });
	if (FORMATS.size >= FORMATS_MAX) {
		let [oldest] = FORMATS.keys();
		FORMATS.delete(oldest);
	}
	FORMATS.set(key, made);
	return made;
}

/**
 * Find and load the config above `root`, merged over bongo's defaults.
 * @example let { config, files } = await load('/site');
 */
export async function load(root: string): Promise<Loaded> {
	let output: Required<Config> = {
		$site: {
			url: '',
			lang: '',
			title: '',
			description: '',
			menu: {},
		},
		$utils: {
			// todo: move all to import
			truncate(text: string, length: number): string {
				return (text || '').substring(0, length);
			},
			countwords(text: string): number {
				let words = (text || '').trim();
				return words ? words.split(/\s+/g).length : 0;
			},
			json(value: unknown): string {
				return (JSON.stringify(value) ?? 'null').replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
			},
			minutes(text: string, wpm = 200): number {
				let words = plain(text);
				return words ? Math.ceil(words.split(' ').length / wpm) : 0;
			},
			excerpt(html: string, length: number): string {
				let text = plain(html);
				if (text.length <= length) return text;
				let space = text.lastIndexOf(' ', length);
				let cut = space > 0 ? text.substring(0, space) : text.substring(0, length);
				return cut.replace(/[\s.,;:!?…-]+$/, '') + '…';
			},
			slug(text: string): string {
				// full case folding, as md4x does: ß is ss, ς is σ
				let folded = (text || '').trim().toUpperCase().toLowerCase().replace(/ς/g, 'σ').replace(/ß/g, 'ss');
				return folded.replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '').replace(/ /g, '-');
			},
			url: {
				abs(to: string, fro?: string): string {
					return new URL(to, fro || output.$site.url.replace(/\/?$/, '/')).href;
				},
				path(to: string, fro?: string): string {
					let url = new URL(to, fro || output.$site.url.replace(/\/?$/, '/'));
					return url.pathname + url.search + url.hash;
				},
				ext(path: string, ext: string): string {
					return withExtension(path, ext, publicPath(output.$site.url));
				}
			},
			date: {
				format(value: string|number|Date, options?: Intl.DateTimeFormatOptions): string {
					let d = new Date(value);
					if (isNaN(d.getTime())) throw new Error(`Invalid date: ${JSON.stringify(value)}`);
					if (!options) return d.toISOString();
					return formatter(output.$site.lang || 'en', options).format(d);
				}
			}
		},
		$loaders: {
			// loaders
		},
		$partials: {
			// custom partials
		},
		$build: {},
		$images: {},
		$hooks: {},
		plugins: [
			// any user plugins
		]
	};

	let file = await find(root, '.');
	if (!file) throw new Error('Missing configuration file');

	let user = await loadModule(file, root);

	// TODO: validate $site keys
	merge(output, (user.exports.default as Partial<Config>) || (user.exports as Partial<Config>));
	output.$build.target ||= 'defaults';

	return { config: output, files: user.files };
}
