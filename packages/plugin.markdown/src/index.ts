import { renderToHtml } from 'md4x';
import type { Config, Args, Loader } from 'bongo';
import type { CodeBlockHighlighter, HtmlOptions } from 'md4x';

export type Options = Omit<HtmlOptions, 'highlighter'> & {
	highlighter?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
};

// TODO: share w/ (inlined) tempura parser
const ARGS = /([a-zA-Z$_][^\s=]*)\s*=\s*((["`'])(?:(?=(\\?))\4.)*?\3|{[^}]*}|\[[^\]]*]|\S+)/g;

async function unpack(raw: string, utils: Loader.Utilities, options?: HtmlOptions): Promise<string> {
	let tag: RegExpExecArray | null;

	// TODO: make this a loader utility ??
	while (tag = /<bongo:(\w+)(?:\s+([^]+?(?=[/]?>)))?(?:(\/>)|>([^]+?)(<\/bongo:\1\>))/g.exec(raw)) {
		let [full, name, attrs, _, inner] = tag;

		let args: Args = {};

		if (attrs) {
			// TODO: share w/ tempura parser
			let tmp: string[] = [];
			let match: RegExpExecArray | null;
			// parse arguments, `defer=true` -> `{ defer: true }`
			while (match = ARGS.exec(attrs)) tmp.push(match[1] + ':' + match[2]);
			// TODO: try / catch ? (share w/ tempura)
			args = Function(`return { ${tmp.join()} }`)();
		}

		if (inner) {
			inner = await unpack(inner.trim(), utils, options);

			if (inner.startsWith('<')) {
				if (inner.startsWith('<p>') && inner.endsWith('</p>\n')) {
					inner = inner.substring(3, inner.length - 5);
				}
			} else {
				inner = renderToHtml(inner, options);
			}

			args.$slot = inner;
		}

		raw = (
			raw.substring(0, tag.index)
			+ await utils.render(name, args)
			+ raw.substring(tag.index + full.length)
		);
	}

	return renderToHtml(raw, options);
}

export function markdown(options?: Options): Partial<Config> {
	let ready: Promise<HtmlOptions> | undefined;

	if (options?.highlighter) {
		ready = Promise.resolve(options.highlighter).then(highlighter => ({
			...options,
			highlighter,
		}));
	}

	return {
		$assets: {
			async md(input, content, utils) {
				let opts = ready ? await ready : options;

				if (typeof content !== 'string') {
					content = utils.decode(content);
				}

				let { offset, value } = utils.frontmatter(content)
				if (offset > 0) content = content.substring(offset);

				content = await unpack(content, utils, opts);

				return {
					filename: input + '.html',
					content: renderToHtml(content, opts),
					metadata: value,
				};
			}
		}
	}
}
