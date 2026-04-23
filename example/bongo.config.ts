import { markdown } from '@bongo/markdown';
import type { Config } from 'bongo';

export default {
	$site: {
		lang: 'en',
		title: 'example',
		url: 'https://example.com',
		description: 'A demo site built with bongo.',
	},

	$utils: {
		year(): number {
			return new Date().getFullYear();
		},
		humanDate(iso: string): string {
			let d = new Date(iso + 'T12:00:00Z');
			return d.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'UTC',
			});
		},
		sortByDate<T extends { params: { date?: unknown } }>(pages: T[]): T[] {
			return [ ...pages ].sort((a, b) => {
				let ad = typeof a.params.date === 'string' ? a.params.date : '';
				let bd = typeof b.params.date === 'string' ? b.params.date : '';
				return bd.localeCompare(ad); // newest first
			});
		},
		truncate(text: string, length: number): string {
			return text.length <= length ? text : text.slice(0, length) + '…';
		},
		countwords(text: string): number {
			return text.trim().split(/\s+/).length;
		},
		url: {
			abs(to: string): string {
				return 'https://example.com' + to;
			},
		},
		date: {
			format(value: string | number | Date): string {
				return new Date(value).toISOString();
			},
		},
	},

	plugins: [
		markdown()
	],
} satisfies Config
