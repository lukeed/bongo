import { renderToHtml } from 'md4x';
import type { Config, Args, Loader } from 'bongo';
import type { CodeBlockHighlighter, HtmlOptions } from 'md4x';

export type Options = Omit<HtmlOptions, 'highlighter'> & {
	highlighter?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
};

type Range = [start: number, end: number];

// TODO: share w/ (inlined) tempura parser
const ARGS = /([a-zA-Z$_][^\s=]*)\s*=\s*((["`'])(?:(?=(\\?))\4.)*?\3|{[^}]*}|\[[^\]]*]|\S+)/g;
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

		let args: Args = {};

		if (attrs = attrs.trim()) {
			// TODO: share w/ tempura parser
			let tmp: string[] = [];
			let match: RegExpExecArray | null;
			// parse arguments, `defer=true` -> `{ defer: true }`
			while (match = ARGS.exec(attrs)) tmp.push(match[1] + ':' + match[2]);
			// TODO: try / catch ? (share w/ tempura)
			args = Function(`return { ${tmp.join()} }`)();
		}

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

				return {
					filename: input + '.html',
					content: restore(renderToHtml(content, opts), stash),
					metadata: value,
				};
			}
		}
	}
}
