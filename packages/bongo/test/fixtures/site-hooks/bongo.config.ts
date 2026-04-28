export default {
	$site: {
		title: 'Hook Fixture',
		url: 'https://example.com/',
		lang: 'en',
	},
	$hooks: {
		pages({ pages }) {
			for (let page of pages) {
				page.feeds = [{
					format: 'rss',
					path: '/feed.xml',
					title: 'Hook Feed',
					type: 'application/rss+xml',
					url: 'https://example.com/feed.xml',
				}];
			}
		},
		output({ pages, write }) {
			return write('/hook-manifest.txt', pages.map(page => page.path).join('\n'));
		},
	},
};
