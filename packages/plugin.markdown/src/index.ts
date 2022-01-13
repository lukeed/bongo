import type { Config, Loader } from 'bongo';
import type MarkdownIt from 'markdown-it';

let mdown: MarkdownIt;

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
