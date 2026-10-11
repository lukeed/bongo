import { parse, join } from 'node:path';
import * as tempura from './tempura/index';
import { href } from './bundler';
import { loadModule } from './config';
import * as images from './images';
import * as log from './log';
import * as fs from './fs';
import * as tags from './tags';
import * as yaml from './yaml';

import type { Argv, Config, Template } from 'bongo';
import type { Args } from './tempura/index';
import type { OutputInfo, Placeholder } from './bundler';

type Cache = Map<string, Template.Compiler>;

/** What layouts, partials, and `.hbs` content see, on top of `$page`, `$pages`, `$section`, and `$tags`. */
export type Context = Omit<Required<Config>, '$assets'> & {
	$assets: { load(filename: string, encoding?: BufferEncoding): Promise<string | Buffer> };
	$data: Record<string, unknown>;
};

export const Layouts: Cache = new Map;
export const Partials: Cache = new Map;

// Strip the extension and normalise backslashes to forward slashes so partial
// names are stable across platforms (Windows' `\`-separated `fs.readdir` paths
// become `/`-separated keys that match layout lookups).
function toPartialName(file: string): string {
	let { ext } = parse(file);
	return file.substring(0, file.length - ext.length).replace(/\\/g, '/');
}

// Module-level blocks object; collect() reassigns its contents via Object.assign
// so that ESM re-exports see mutations (Bun ESM is quirky about let re-exports).
export const blocks: {
	partial(args: Record<string, unknown>): Promise<string> | string;
	[key: string]: unknown;
} = {
	// Placeholder replaced by collect() — calling before collect() throws.
	partial(_args) {
		throw new Error('blocks.partial called before collect()');
	},
};

function makeBlocks(_argv: Required<Argv>, _config: Context) {
	return {
		/**
		 * Alternative partial format
		 * @note Partials do not have `$page` info
		 * @example {{#partial src="minutes" text="hello world" }}
		 * @example {{#partial src="minutes.hbs" text="hello world" }}
		 */
		partial(args: Record<string, unknown>): Promise<string> | string {
			let { src, ...rest } = args as { src?: string } & Record<string, unknown>;
			if (!src) throw new Error('<partial src="..."> missing "src"');
			let key = toPartialName(src);
			let render = Partials.get(key);
			if (render) return render(rest as Args);
			throw new Error(`Unknown "${key}" partial!`);
		},
	};
}

// Content compiles in walk 2 with the same context layouts see — `$page`,
// `$pages`, `$section`, `$tags` are all available. One caveat: the current
// page's own `$page.content` is the empty string during its own body's
// compile (it IS what this compile is about to produce). Referencing it
// inside the body would be nonsensical anyway.
export async function compileContent(src: string): Promise<Template.Compiler> {
	let options: tempura.Options = {
		async: true,
		// `params` remains a top-level var (an alias to `$page.params`) so
		// existing `.hbs` templates using `{{ params.title }}` keep working.
		props: ['$site', '$page', '$pages', '$section', '$tags', '$assets', '$utils', '$data', 'params'],
		blocks: blocks as unknown as tempura.Blocks,
	};
	return tempura.compile(src, options);
}

function isCompiler(input: unknown): input is Template.Compiler {
	return typeof input === 'function';
}

export async function collect(argv: Required<Argv>, config: Context): Promise<void> {
	let made = makeBlocks(argv, config);

	// Re-assign onto the exported const so ESM consumers see the new closures.
	Object.assign(blocks, made);

	let props = ['$site', '$page', '$pages', '$section', '$tags', '$assets', '$utils', '$data'];
	// tempura blocks is typed as Blocks (Record<string, Block>); we cast through
	// unknown to satisfy the index signature without using `any`.
	let options: tempura.Options = { async: true, props, blocks: blocks as unknown as tempura.Blocks };

	async function compile(dir: string, rel: string) {
		try {
			let file = join(dir, rel);
			let content = await fs.read(file, 'utf8');
			return tempura.compile(content, options);
		} catch (err) {
			let type = parse(dir).name.slice(0, -1); // strip "s"
			let reason = err instanceof Error ? err.message : String(err);
			let tmp = new Error(`Error compiling "${rel}" ${type}: ${reason}`, {
				cause: err,
			});
			throw tmp;
		}
	}

	let isHBS = /\.hbs$/i;
	let isJS = /\.([mc]?js|ts)$/i;
	let { layouts, partials } = argv;
	let debug = argv.debug ? log.debug : () => {};

	if (fs.exists(partials)) {
		await fs.list(partials, async (_, rel) => {
			if (isHBS.test(rel) || isJS.test(rel)) {
				let key = toPartialName(rel);
				debug('[collect.partials]', key);
				// @ts-ignore - setting placeholders
				Partials.set(key, blocks[key] = rel);
			}
		});

		for (let [key, rel] of Partials) {
			let file = String(rel);
			let render: Template.Compiler;
			if (isHBS.test(file)) {
				render = await compile(partials, file);
			} else {
				let mod = await loadModule(join(partials, file), argv.cwd);
				let fn = mod.exports.default || mod.exports;
				if (!isCompiler(fn)) throw new Error(`Partial "${file}" must export a render function`);
				render = fn;
			}

			// NOTE: Partials do NOT have access to `$page` var
			let compiler = (x: Args) => render({ ...x, ...config }, blocks as unknown as tempura.Blocks);
			Partials.set(key, blocks[key] = compiler);
		}
	}

	for (let name in config.$partials) {
		let key = toPartialName(name);
		debug('[collect.$partials]', key);
		let compiler = config.$partials[name];
		Partials.set(key, blocks[key] = compiler);
	}

	await fs.list(layouts, async (_, rel) => {
		if (isHBS.test(rel)) {
			debug('[collect.layouts]', rel);
			Layouts.set(rel, await compile(layouts, rel));
		}
	});
}

export type SubstituteOptions = {
	outputs: Map<Placeholder, OutputInfo>;
	publicPath: string;                   // e.g. '/' or '/blog/'
	readFile: (filename: string) => Promise<string>;
};

const PLACEHOLDER_RE = /__BONGO_BUNDLE:[a-f0-9]{16}__/g;
const INLINE_STYLE_RE = /<style data-bongo-inline="(__BONGO_BUNDLE:[a-f0-9]{16}__)"><\/style>/g;
const INLINE_SCRIPT_RE = /<script([^>]*)data-bongo-inline="(__BONGO_BUNDLE:[a-f0-9]{16}__)"([^>]*)><\/script>/g;
const IMAGE_RE = /<img data-bongo-image="(__BONGO_BUNDLE:[a-f0-9]{16}__)"((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*\/?>/g;

export async function substitute(html: string, opts: SubstituteOptions): Promise<string> {
	let { outputs, publicPath, readFile } = opts;

	// Pass 2a: inline <style> — replace element entirely.
	let inlineStyleTasks: Promise<[string, string]>[] = [];
	html.replace(INLINE_STYLE_RE, (_match, token) => {
		let p = token as Placeholder;
		let info = outputs.get(p);
		if (!info) throw new Error(`Unresolved inline style placeholder: ${token}`);
		inlineStyleTasks.push(readFile(info.filename).then(contents => [_match, `<style>${contents}</style>`]));
		return _match;
	});

	let inlineStyles = await Promise.all(inlineStyleTasks);
	for (let [match, replacement] of inlineStyles) {
		html = html.replace(match, replacement);
	}

	// Pass 2b: inline <script> — replace element entirely, preserving other attrs.
	let inlineScriptTasks: Promise<[string, string]>[] = [];
	html.replace(INLINE_SCRIPT_RE, (_match, attrsBefore, token, attrsAfter) => {
		let p = token as Placeholder;
		let info = outputs.get(p);
		if (!info) throw new Error(`Unresolved inline script placeholder: ${token}`);
		// Drop the data-bongo-inline attribute; keep any other attrs.
		let otherAttrs = (attrsBefore + ' ' + attrsAfter).replace(/\s+/g, ' ').trim();
		let attrPart = otherAttrs ? ' ' + otherAttrs : '';
		inlineScriptTasks.push(readFile(info.filename).then(contents => [_match, `<script${attrPart}>${contents}</script>`]));
		return _match;
	});

	let inlineScripts = await Promise.all(inlineScriptTasks);
	for (let [match, replacement] of inlineScripts) {
		html = html.replace(match, replacement);
	}

	// Pass 2c: images — each stand-in <img> becomes its <source> set and final <img>.
	html = html.replace(IMAGE_RE, (_match, token: string, attrs: string) => {
		let info = outputs.get(token as Placeholder)?.image;
		if (!info) throw new Error(`Unresolved image placeholder: ${token}`);
		return images.render(info, tags.parseAttrs(attrs), name => href(publicPath, name));
	});

	// Pass 2d: external placeholders in href/src — swap in {publicPath}{filename}.
	html = html.replace(PLACEHOLDER_RE, (token) => {
		let p = token as Placeholder;
		let info = outputs.get(p);
		if (!info) throw new Error(`Unresolved external placeholder: ${token}`);
		return href(publicPath, info.filename);
	});

	return html;
}

function isMap(value: unknown): value is Template.Params {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/;

/**
 * Parse the `---` fenced YAML block at the top of `content`; see `yaml.parse` for the subset.
 * `offset` is where the body starts, or 0 when there is no block.
 * @example frontmatter('---\ntitle: Hi\ndraft: true\n---\nBody') //=> { offset: 29, value: { title: 'Hi', draft: true } }
 */
export function frontmatter(content: string): {
	offset: number;
	value: Template.Params
} {
	let match = FRONTMATTER.exec(content);
	if (!match) return { offset: 0, value: {} };

	try {
		var value = yaml.parse(match[1] || '', 2);
	} catch (err) {
		throw new Error(`Invalid frontmatter: ${err instanceof Error ? err.message : err}`, { cause: err });
	}

	if (value == null) return { offset: match[0].length, value: {} };
	if (!isMap(value)) throw new Error('Invalid frontmatter: expected "key: value" lines');
	return { offset: match[0].length, value };
}
