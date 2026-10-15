import { markdown } from '@bongo/markdown';
import { twinkleplop } from '@bongo/markdown/twinkleplop';
import { language as bash } from '@twinkleplop/bash';
import { language as css } from '@twinkleplop/css';
import { language as json } from '@twinkleplop/json';
import { language as typescript } from '@twinkleplop/typescript';

import type { Config, Template } from 'bongo';

export default {
	$site: {
		lang: 'en',
		title: 'bench',
		url: 'https://bench.example.com/',
		description: 'A large generated site to measure bongo builds.',
	},
	$utils: {
		humanDate(iso: string): string {
			return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'UTC',
			});
		},
		sections(pages: Template.PageInfo[]): Template.PageInfo[] {
			return pages.filter(page => page.section !== '' && page.path === `/${page.section}/`);
		},
		pager(section: Template.PageInfo[], path: string): { prev?: Template.PageInfo; next?: Template.PageInfo } {
			let index = section.findIndex(page => page.path === path);
			return { prev: section[index - 1], next: section[index + 1] };
		},
	},
	plugins: [
		markdown({
			headingIds: true,
			highlighter: twinkleplop({
				languages: {
					bash: bash(),
					css: css(),
					json: json(),
					typescript: typescript(),
				},
			}),
		}),
	],
} satisfies Config;
