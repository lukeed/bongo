import { feed } from '../../../../plugin.feed/src/index';

export default {
	$site: {
		url: 'https://example.com/',
		title: 'Feed Fixture',
		description: 'Fixture for @bongo/feed integration tests',
		lang: 'en',
	},
	plugins: [
		feed(),
	],
};
