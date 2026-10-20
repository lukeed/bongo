import { getCollection } from 'astro:content';

import type { CollectionEntry } from 'astro:content';

export type Page = CollectionEntry<'pages'>;

export const SITE = {
	lang: 'en',
	title: 'bench',
	url: 'https://bench.example.com/',
	description: 'A large generated site to measure bongo builds.',
};

let all: Promise<Page[]> | undefined;

export function pages(): Promise<Page[]> {
	return all ??= getCollection('pages').then(list => list.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })));
}

export function section(page: Page): string {
	let parts = page.id.split('/');
	return parts.length > 1 ? parts[0] : '';
}

export function path(page: Page): string {
	if (page.id === 'index') return '/';
	return '/' + page.id.replace(/(^|\/)index$/, '') + '/';
}

export function isIndex(page: Page): boolean {
	return page.id === 'index' || page.id.endsWith('/index');
}

let format = new Intl.DateTimeFormat(SITE.lang, { dateStyle: 'long', timeZone: 'UTC' });

export function date(value: Date): string {
	return format.format(value);
}
