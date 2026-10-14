import { parseAST, renderToHtml } from 'md4x';
import type { Config, Args, Loader } from 'bongo';
import type { CodeBlockHighlighter, ComarkNode, ComarkTree, HtmlOptions } from 'md4x';

export type Options = Omit<HtmlOptions, 'highlighter'> & {
	highlighter?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
};

type Range = [start: number, end: number];

// TODO: share w/ (inlined) tempura parser
const TAG = /<bongo:(\w+)((?:"[^"]*"|'[^']*'|`[^`]*`|{[^}]*}|[^>"'`{/]|\/(?!>))*)(?:(\/>)|>([^]*?)<\/bongo:\1\s*>)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Elements bongo itself replaces after layouts render; they are kept verbatim, not rendered as partials.
const BUILTIN = new Set(['asset', 'client', 'image', 'script', 'style']);

// Partial output is stashed behind private-use tokens so markdown never re-parses its HTML.
const TOKEN = (idx: number) => `\uE000${idx}\uE001`;
const TOKENS = /<p>\uE000(\d+)\uE001<\/p>\n?|\uE000(\d+)\uE001/g;

function restore(html: string, stash: string[]): string {
	return html.replace(TOKENS, (_, block: string | undefined, inline: string | undefined) => stash[Number(block ?? inline)]);
}

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const HEADING = /^h[1-6]$/;

function escape(text: string): string {
	return text.replace(/[&<>"]/g, char => ESCAPE[char]);
}

function inline(node: ComarkNode): string {
	if (typeof node === 'string') return escape(node);
	let [tag, props, ...children] = node;
	if (tag === 'html') return children.filter(child => typeof child === 'string').join('');
	let inner = children.map(inline).join('');
	if (!tag) return inner;
	let attrs = '';
	for (let key in props) {
		let value = props[key];
		if (value === true) attrs += ` ${key}`;
		else if (value != null && value !== false) attrs += ` ${key}="${escape(String(value))}"`;
	}
	return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${inner}</${tag}>`;
}

// md4x builds a heading id from its text, stash tokens included; drop them, keep each id unique.
function anchors(tree: ComarkTree): Map<string, string> {
	let out = new Map<string, string>();
	let taken = new Set(tree.meta.headings.map(heading => heading.id));
	for (let { id } of tree.meta.headings) {
		if (!id.includes('\uE000')) continue;
		let base = id.replace(/\uE000\d+\uE001/g, '');
		let next = base;
		for (let n = 1; taken.has(next); n++) next = `${base}-${n}`;
		taken.add(next);
		out.set(id, next);
	}
	return out;
}

function headings(tree: ComarkTree, ids: Map<string, string>, stash: string[]): Loader.Heading[] {
	let inner = new Map<string, string>();
	let walk = (nodes: ComarkNode[]): void => {
		for (let node of nodes) {
			if (typeof node === 'string') continue;
			let [tag, props, ...children] = node;
			if (tag && HEADING.test(tag) && typeof props.id === 'string') inner.set(props.id, restore(children.map(inline).join(''), stash));
			else walk(children);
		}
	};
	walk(tree.nodes);
	return tree.meta.headings.map(heading => ({
		level: heading.level,
		id: ids.get(heading.id) ?? heading.id,
		text: heading.text.replace(/\uE000\d+\uE001/g, ''),
		html: inner.get(heading.id),
	}));
}

// Inline code spans: a backtick run closed by the next run of the same length, within one block.
function spans(raw: string, from: number, to: number, out: Range[]): void {
	let ticks = /`+/g;
	let run: RegExpExecArray | null;
	ticks.lastIndex = from;

	while ((run = ticks.exec(raw)) && run.index < to) {
		let size = run[0].length;
		let close = new RegExp(`(?<!\`)\`{${size}}(?!\`)`, 'g');
		close.lastIndex = run.index + size;
		let end = close.exec(raw);
		if (!end || end.index >= to) continue;
		if (/\n[ \t]*\n/.test(raw.slice(run.index, end.index))) continue;
		out.push([run.index, end.index + size]);
		ticks.lastIndex = end.index + size;
	}
}

// Fenced code blocks and inline code spans, where `<bongo:*>` is documentation, not a partial.
function code(raw: string): Range[] {
	let out: Range[] = [];
	let open: { char: string; size: number; start: number } | undefined;
	let prose = 0, pos = 0;

	for (let line of raw.split('\n')) {
		let end = pos + line.length;
		let fence = FENCE.exec(line);

		if (open) {
			if (fence && fence[1][0] === open.char && fence[1].length >= open.size && !line.slice(fence[0].length).trim()) {
				out.push([open.start, end]);
				prose = end;
				open = undefined;
			}
		} else if (fence && !(fence[1][0] === '`' && line.slice(fence[0].length).includes('`'))) {
			spans(raw, prose, pos, out);
			open = { char: fence[1][0], size: fence[1].length, start: pos };
		}

		pos = end + 1;
	}

	if (open) out.push([open.start, raw.length]);
	else spans(raw, prose, raw.length, out);

	return out;
}

async function unpack(raw: string, stash: string[], utils: Loader.Utilities, options?: HtmlOptions): Promise<string> {
	let tag: RegExpExecArray | null;
	let skip = code(raw);
	let tags = new RegExp(TAG.source, 'g');

	// TODO: make this a loader utility ??
	while (tag = tags.exec(raw)) {
		let at = tag.index;
		let hit = skip.find(([start, end]) => at >= start && at < end);
		if (hit) {
			tags.lastIndex = hit[1];
			continue;
		}

		let [full, name, attrs, _, inner] = tag;

		if (BUILTIN.has(name)) {
			let token = TOKEN(stash.push(full) - 1);
			raw = raw.substring(0, at) + token + raw.substring(at + full.length);
			skip = code(raw);
			tags.lastIndex = at + token.length;
			continue;
		}

		// TODO: share w/ tempura parser
		// parse arguments, `defer=true` -> `{ defer: true }`
		// TODO: try / catch ? (share w/ tempura)
		let args: Args = utils.attrs(attrs);

		if (inner) {
			let html = restore(renderToHtml(await unpack(inner.trim(), stash, utils, options), options), stash);
			// unwrap a lone paragraph so inline slots stay inline
			if (html.startsWith('<p>') && html.endsWith('</p>\n') && html.indexOf('<p>', 3) === -1) {
				html = html.substring(3, html.length - 5);
			}
			args.$slot = html;
		}

		let token = TOKEN(stash.push(await utils.render(name, args)) - 1);
		raw = raw.substring(0, at) + token + raw.substring(at + full.length);
		skip = code(raw);
		tags.lastIndex = at + token.length;
	}

	return raw;
}

export function markdown(options: Options = {}): Partial<Config> {
	let { highlighter, ...rest } = options;
	let ready: Promise<HtmlOptions> = Promise.resolve(highlighter).then(fn => ({ ...rest, highlighter: fn }));

	return {
		$assets: {
			async md(input, content, utils) {
				let opts = await ready;

				if (typeof content !== 'string') {
					content = utils.decode(content);
				}

				let { offset, value } = utils.frontmatter(content)
				if (offset > 0) content = content.substring(offset);

				let stash: string[] = [];
				content = await unpack(content, stash, utils, opts);

				let tree = parseAST(content);
				let ids = anchors(tree);
				let html = renderToHtml(content, opts);
				if (ids.size) html = html.replace(/<h([1-6]) id="([^"]*)"/g, (tag, level: string, id: string) => ids.has(id) ? `<h${level} id="${ids.get(id)}"` : tag);

				return {
					filename: input + '.html',
					content: restore(html, stash),
					metadata: value,
					headings: headings(tree, ids, stash),
				};
			}
		}
	}
}
