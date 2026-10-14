import { markdown } from '@bongo/markdown';
import { shiki } from '@bongo/markdown/highlight';
import type { Config } from 'bongo';

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
	},
	plugins: [
		markdown({
			highlighter: shiki({ theme: 'github-dark' }),
		}),
	],
} satisfies Config;
