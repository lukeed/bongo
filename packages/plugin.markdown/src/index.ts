import type { Config, Args } from 'bongo';
import type MarkdownIt from 'markdown-it';

let mdown: MarkdownIt;

// TODO: make this a loader utility ??
const INLINE = /<bongo:(\w+)(?:\s+([^]+?(?=[/]?>)))?(?:(\/>)|>([^]+?)(<\/bongo:\1\>))/g;

// TODO: share w/ (inlined) tempura parser
const ARGS = /([a-zA-Z$_][^\s=]*)\s*=\s*((["`'])(?:(?=(\\?))\4.)*?\3|{[^}]*}|\[[^\]]*]|\S+)/g;

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
				mdown = mdown || await import('markdown-it').then(m => m.default(options!));

				if (typeof content !== 'string') {
					content = utils.decode(content);
				}

				let { offset, value } = utils.frontmatter(content)
				if (offset > 0) content = content.substring(offset);

				let tag: RegExpExecArray | null;
				while (tag = INLINE.exec(content)) {
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

					// TODO: loop/recurse `inner`
					if (inner) args.$slot = mdown.render(inner);

					content = (
						content.substring(0, tag.index)
						+ await utils.render(name, args)
						+ content.substring(tag.index + full.length)
					);
				}

				content = mdown.render(content);

				return {
					filename: input + '.html',
					content: mdown.render(content),
					metadata: value,
				};
			}
		}
	}
}
