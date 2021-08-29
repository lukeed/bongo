import type { Config } from '../packages/bongo';
import type * as markdown from 'markdown-it';

console.log('INSIDE TS CONFIG FILE');

let mdown: markdown;

const config: Config = {
	$site: {
		url: 'https://asd.com/',
		title: 'demo site',
		lang: 'en',
	},

	$assets: {
		html(filename, content) {
			console.log('DONT', { filename, content });
			return { filename, content };
		},
		async md(input, content) {
			mdown = mdown || await import('markdown-it').then(m => m.default({
				html: true,
				linkify: true,
				typographer: true
			}));

			if (typeof content !== 'string') {
				content = new TextDecoder().decode(content);
			}

			let metadata = {};
			let filename = input + '.html';
			let match = /---\r?\n([\s\S]+?)\r?\n---/.exec(content);

			if (match != null) {
				content = content.substring(match[0].length);
				match[1].split('\n').forEach(pair => {
					let [key, ...v] = pair.split(':');
					metadata[key.trim()] = v.join(':').trim();
				});
			}

			content = mdown.render(content);
			return { filename, content, metadata };
		}
	}
}

export default config;
