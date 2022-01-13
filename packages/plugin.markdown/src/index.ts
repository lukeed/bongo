import type { Config, Args, Loader } from 'bongo';
import type MarkdownIt from 'markdown-it';

let mdown: MarkdownIt;

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
			inner = await unpack(inner.trim(), utils);
			args.$slot = mdown.render(inner);
		}

		raw = (
			raw.substring(0, tag.index)
			+ await utils.render(name, args)
			+ raw.substring(tag.index + full.length)
		);
	}

	return mdown.render(raw);
}

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

				content = await unpack(content, utils);

				return {
					filename: input + '.html',
					content: mdown.render(content),
					metadata: value,
				};
			}
		}
	}
}
