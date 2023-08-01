import type { Args } from 'tempura';
import type MarkdownIt from 'markdown-it';
import type { Config, Loader } from '../types';

type Loaders = {
	md: Loader;
};

// TODO: share w/ (inlined) tempura parser
const ARGS = /([a-zA-Z$_][^\s=]*)\s*=\s*((["`'])(?:(?=(\\?))\4.)*?\3|{[^}]*}|\[[^\]]*]|\S+)/g;

async function unpack(raw: string, utils: Loader.Utilities): Promise<string> {
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
			console.log('>> before', { inner });
			inner = await unpack(inner.trim(), utils);
			console.log('>> after', { inner });

			if (inner.startsWith('<')) {
				if (inner.startsWith('<p>') && inner.endsWith('</p>\n')) {
					inner = inner.substring(3, inner.length - 5);
				}
			} else {
				inner = $markdown.render(inner);
			}

			args.$slot = inner;
		}

		raw = raw.substring(0, tag.index)
				+ await utils.render(name, args)
				+ raw.substring(tag.index + full.length);
	}

	return $markdown.render(raw);
}

let $markdown: MarkdownIt;
export function markdown(options?: MarkdownIt.Options): Partial<Config> {
	options = {
		html: true,
		linkify: true,
		typographer: true,
		...options,
	};

	return {
		$assets: {
			async md(input, content, utils) {
				$markdown ||= await import('markdown-it').then(m => m.default(options!));

				if (typeof content !== 'string') {
					content = content.toString();
				}

				let { offset, value } = utils.frontmatter(content)
				if (offset > 0) content = content.substring(offset);

				content = await unpack(content, utils);

				return {
					filename: input + '.html',
					content: $markdown.render(content),
					metadata: value,
				};
			}
		}
	}
}
