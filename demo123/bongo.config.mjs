/**
 * @typedef {import('..').Config} Config
 */

/** @type {Config['$site']} */
export const $site = {
	title: 'Demo Site',
	lang: 'en',
	url: 'https://demo.com/',
}

let mdown;

/**
 * @type {Config['$assets']}
 */
export const $assets = {
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
