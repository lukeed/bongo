// import { define } from './bongo/config';
import { markdown } from './bongo/plugins/markdown.mjs';

/**
 * @type {import('./bongo/types').Config}
 */
const config = {
	$site: {
		lang: 'en',
		title: 'My Website',
		url: 'https://example.com/',
	},
	plugins: [
		markdown()
	]
};

export default config;
