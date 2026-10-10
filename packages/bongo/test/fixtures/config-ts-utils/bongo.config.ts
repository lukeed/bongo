import type { Config } from 'bongo';

export default {
	$site: {
		lang: 'en',
		title: 'Utils Fixture',
		url: 'https://example.com',
	},
	$utils: {
		year(): number {
			return 2026;
		},
		url: {
			rel(to: string): string {
				return to;
			},
		},
	},
} satisfies Config;
