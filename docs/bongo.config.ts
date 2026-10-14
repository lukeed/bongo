import { markdown } from '@bongo/markdown';
import { twinkleplop } from '@bongo/markdown/twinkleplop';

import * as code from './code';
import * as utils from './utils';

import type { Config } from 'bongo';

export default {
	$site: {
		lang: 'en',
		title: 'bongo',
		url: 'https://bongo.build/',
		description: 'A static site generator built on Rolldown and LightningCSS.',
	},
	$utils: { ...utils },
	$hooks: {
		transform: code.transform,
	},
	plugins: [
		markdown({
			headingIds: true,
			highlighter: twinkleplop({ languages: code.languages }),
		}),
	],
} satisfies Config;
