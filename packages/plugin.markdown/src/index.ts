import type { Config, Template } from 'bongo';
import type MarkdownIt from 'markdown-it';

let mdown: MarkdownIt;

export const $assets: Config['$assets'] = {
	async md(input, content) {
		mdown = mdown || await import('markdown-it').then(m => m.default({
			html: true,
			linkify: true,
			typographer: true
		}));

		if (typeof content !== 'string') {
			content = new TextDecoder().decode(content);
		}

		let metadata: Template.Params = {};
		let match = /---\r?\n([\s\S]+?)\r?\n---/.exec(content);

		if (match != null) {
			content = content.substring(match[0].length);
			match[1].split('\n').forEach(pair => {
				let idx = pair.indexOf(':');
				let key = pair.substring(0, idx++).trim();
				metadata[key] = pair.substring(idx).trim();
			});
		}

		let filename = input + '.html';
		content = mdown.render(content);
		return { filename, content, metadata };
	}
}
