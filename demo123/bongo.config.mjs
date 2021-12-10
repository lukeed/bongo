import markdown from '@bongo/markdown';

/**
 * @typedef {import('..').Config} Config
 */

/** @type {Config['$site']} */
export const $site = {
	title: 'Demo Site',
	lang: 'en',
	url: 'https://demo.com/',
}

/**
 * @type {Config['$assets']}
 */
export const $assets = {
	html(filename, content) {
		console.log('DONT', { filename, content });
		return { filename, content };
	}
}

/**
 * @type {Config['plugins']}
 */
export const plugins = [
	markdown
]
