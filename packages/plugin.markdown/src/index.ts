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
			async md(input, content) {
				mdown = mdown || await import('markdown-it').then(m => m.default(options!));

				if (typeof content !== 'string') {
					content = new TextDecoder().decode(content);
				}

				let filename = input + '.html';
				let metadata: Loader.Metadata = {};
				let match = /---\r?\n([\s\S]+?)\r?\n---/.exec(content);

				if (match != null) {
					content = content.substring(match[0].length);
					match[1].split('\n').forEach(pair => {
						let idx = pair.indexOf(':');
						let key = pair.substring(0, idx++).trim();
						metadata[key] = pair.substring(idx).trim();
					});
				}

				content = mdown.render(content);
				return { filename, content, metadata };
			}
		}
	}
}
