import { feed } from '../../../../plugin.feed/src/index';

export default {
	$site: {
		url: 'https://example.com/',
		title: 'Empty Feed Fixture',
		lang: 'en',
	},
	plugins: [
		feed(),
	],
};
