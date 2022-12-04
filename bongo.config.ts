import { define } from 'bongo';
import { markdown } from '@bongo/markdown';

export default define({
	$site: {
		lang: 'en',
		title: 'My Website',
		url: 'https://example.com',
	},
	plugins: [
		markdown()
	]
});
