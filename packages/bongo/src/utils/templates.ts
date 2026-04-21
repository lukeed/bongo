import { parse, join } from 'node:path';
import * as tempura from './tempura/index';
import * as bundler from './bundler';
import * as log from './log';
import * as fs from './fs';

import type { Argv, Config, Template } from 'bongo';
import type { Args } from './tempura/index';
import type { OutputInfo, Placeholder } from './bundler';

type Cache = Map<string, Template.Compiler>;

export const Layouts: Cache = new Map;
export const Partials: Cache = new Map;

// Strip the extension and normalise backslashes to forward slashes so partial
// names are stable across platforms (Windows' `\`-separated `fs.readdir` paths
// become `/`-separated keys that match layout lookups).
function toPartialName(file: string): string {
	let { ext } = parse(file);
	return file.substring(0, file.length - ext.length).replace(/\\/g, '/');
}

namespace BlockArgs {
	export type Script = {
		src?: string;
		async?: boolean;
		defer?: boolean;
		inline?: boolean;
		format?: 'esm' | 'cjs';
		target?: string;
	};

	export type Style = {
		src?: string;
		preload?: boolean;
	};

	export type Link = {
		href?: string;
		rel?: string;
	};
}

// Module-level blocks object; collect() reassigns its contents via Object.assign
// so that ESM re-exports see mutations (Bun ESM is quirky about let re-exports).
export const blocks: {
	style(args: Record<string, unknown>): Promise<string>;
	link(args: Record<string, unknown>): Promise<string>;
	script(args: Record<string, unknown>): Promise<string>;
	partial(args: Record<string, unknown>): Promise<string> | string;
	[key: string]: unknown;
} = {
	// Placeholders replaced by collect() — calling before collect() throws.
	style(_args) {
		return Promise.reject(new Error('blocks.style called before collect()'));
	},
	link(_args) {
		return Promise.reject(new Error('blocks.link called before collect()'));
	},
	script(_args) {
		return Promise.reject(new Error('blocks.script called before collect()'));
	},
	partial(_args) {
		throw new Error('blocks.partial called before collect()');
	},
};

function makeBlocks(argv: Required<Argv>, config: Required<Config>) {
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

		/**
		 * Inline-by-default stylesheet block. Registers a CSS entry and emits a
		 * placeholder that pass 2 (build.ts) will replace with inlined <style> contents.
		 * @example {{#style src="index.css"}}
		 */
		async style(args: Record<string, unknown>): Promise<string> {
			let { src } = args as BlockArgs.Style;
			if (!src) throw new Error('<style src="..."> missing "src" attribute');

			let entry = join(argv.assets, src);
			fs.assert(entry, `assets/${src}`);

			let placeholder = bundler.register(entry, {
				kind: 'css',
				targets: config.$build.target,
			});

			// Inline by the rule: <style> tags with a src= become inline <style>…</style>.
			// Preload is meaningless for inline (content is in the HTML already).
			return `<style data-bongo-inline="${placeholder}"></style>`;
		},

		/**
		 * External stylesheet block. Registers a CSS entry and emits a placeholder
		 * in the href attribute that pass 2 replaces with the hashed public URL.
		 * Non-stylesheet rels are passed through unchanged.
		 * @example {{#link rel="stylesheet" href="index.css"}}
		 */
		async link(args: Record<string, unknown>): Promise<string> {
			let { href, rel } = args as BlockArgs.Link;
			if (!href) throw new Error('<link href="..."> missing "href" attribute');
			if (rel !== 'stylesheet') {
				// Only rel=stylesheet is a bundling concern — pass others through.
				return `<link${rel ? ` rel="${rel}"` : ''} href="${href}"/>`;
			}

			let entry = join(argv.assets, href);
			fs.assert(entry, `assets/${href}`);

			let placeholder = bundler.register(entry, {
				kind: 'css',
				targets: config.$build.target,
			});
			return `<link rel="stylesheet" href="${placeholder}"/>`;
		},

		/**
		 * Process/bundle a script file. Emits a placeholder in src (external) or
		 * in data-bongo-inline (inline); pass 2 resolves and substitutes.
		 * @example {{#script src="main.ts" target="es2019" format="esm" async=true }}
		 * @example {{#script src="demo.mjs" inline=true }}
		 */
		async script(args: Record<string, unknown>): Promise<string> {
			let { src, async: isAsync, defer, inline, format, target } = args as BlockArgs.Script;
			if (!src) throw new Error('<script src="..."> missing "src" attribute');

			let entry = join(argv.assets, src);
			fs.assert(entry, `assets/${src}`);

			let placeholder = bundler.register(entry, {
				kind: 'js',
				format: format === 'cjs' ? 'cjs' : 'esm',
				// Explicit block arg wins; fall back to config.$build.target.
				target: target ?? config.$build.target,
			});

			if (inline) {
				return `<script data-bongo-inline="${placeholder}"></script>`;
			}

			// External: normal HTML script tag with placeholder in src.
			let attrs = '';
			if (isAsync) attrs += ' async';
			if (format !== 'cjs') attrs += ' type="module"';
			else if (defer) attrs += ' defer';
			return `<script${attrs} src="${placeholder}"></script>`;
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
		props: ['$site', '$page', '$pages', '$section', '$tags', '$assets', '$utils', 'params'],
		blocks: blocks as unknown as tempura.Blocks,
	};
	return tempura.compile(src, options);
}

export async function collect(argv: Required<Argv>, config: Required<Config>): Promise<void> {
	let made = makeBlocks(argv, config);

	// Re-assign onto the exported const so ESM consumers see the new closures.
	Object.assign(blocks, made);

	let props = ['$site', '$page', '$pages', '$section', '$tags', '$assets', '$utils'];
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
			let render = isHBS.test(file)
				? await compile(partials, file)
				: await fs.load(file, partials);

			render = render.default || render;

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

	// Pass 2c: external placeholders in href/src — swap in {publicPath}{filename}.
	html = html.replace(PLACEHOLDER_RE, (token) => {
		let p = token as Placeholder;
		let info = outputs.get(p);
		if (!info) throw new Error(`Unresolved external placeholder: ${token}`);
		return publicPath + info.filename;
	});

	return html;
}

// Strip surrounding matching quotes from a string value.
// If the string is surrounded by matching `"..."` or `'...'`, remove them.
// Mismatched or missing quotes are left intact.
function unquote(raw: string): string {
	if (raw.length >= 2) {
		let first = raw.charAt(0);
		let last = raw.charAt(raw.length - 1);
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return raw.slice(1, -1);
		}
	}
	return raw;
}

export function frontmatter(content: string): {
	offset: number;
	value: Template.Params
} {
	let value: Template.Params = {};

	if (content.substring(0, 3) !== '---') {
		return { offset: 0, value };
	}

	let match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(content);
	if (match == null) 	return { offset: 0, value };

	match[1].split('\n').forEach(pair => {
		let [key, ...v] = pair.split(':');
		value[key.trim()] = unquote(v.join(':').trim());
	});

	return { offset: match[0].length, value };
}
