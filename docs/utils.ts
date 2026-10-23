import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Template } from 'bongo';

export type Link = {
	title: string;
	path: string;
	/** `page` on the page itself, `true` on a page below it. */
	current?: 'page' | 'true';
};

export type Group = {
	title: string;
	color: string;
	pages: Link[];
};

const GROUPS = [
	['Start', 'sun'],
	['Guides', 'tomato'],
	['Runtime', 'lilac'],
	['Reference', 'mint'],
	['Plugins', 'sky'],
];

const REPO = 'https://github.com/lukeed/bongo';

/**
 * Group the docs pages for the sidebar, in the `GROUPS` order, then by each page's `order` frontmatter.
 * A page is current on its own path, and on the paths below it as their parent, as `/releases/` is on `/releases/v1.1.0/`.
 * @example $utils.nav($pages, $page.path) //=> [{ title: 'Start', color: 'sun', pages: [{ title: 'Introduction', path: '/intro/', current: true }] }]
 */
export function nav(pages: Template.PageInfo[], current: string): Group[] {
	return GROUPS.map(([title, color]) => ({
		title,
		color,
		pages: pages
			.filter(page => page.params.group === title)
			.toSorted((a, b) => Number(a.params.order) - Number(b.params.order))
			.map(page => ({ title: page.title, path: page.path, current: page.path === current ? 'page' as const : current.startsWith(page.path) ? 'true' as const : undefined })),
	}));
}

/**
 * The docs pages before and after the current one, in sidebar order.
 * @example $utils.pager($pages, '/templates/') //=> { prev: { title: 'Frontmatter', … }, next: { title: 'Partials', … } }
 */
export function pager(pages: Template.PageInfo[], current: string): { prev?: Link; next?: Link } {
	let links = nav(pages, current).flatMap(group => group.pages);
	let index = links.findIndex(link => link.path === current);
	if (index === -1) return {};
	return { prev: links[index - 1], next: links[index + 1] };
}

/**
 * The release pages, newest version first.
 * @example $utils.releases($pages).map(page => page.title) //=> ['v1.1.0', 'v1.0.0']
 */
export function releases(pages: Template.PageInfo[]): Template.PageInfo[] {
	let parts = (page: Template.PageInfo) => page.title.replace(/^v/, '').split(/[.-]/).map(part => Number(part) || 0);
	return pages
		.filter(page => page.section === 'releases')
		.toSorted((a, b) => {
			let x = parts(a), y = parts(b);
			let i = x.findIndex((n, k) => n !== y[k]);
			return i === -1 ? 0 : y[i] - x[i];
		});
}

/**
 * Text with `code` spans as HTML: the text is escaped, and each backtick pair becomes `<code>`.
 * @example $utils.inline('a `bongo/env` type') //=> 'a <code>bongo/env</code> type'
 */
export function inline(text: string): string {
	let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Text without the backticks of its `code` spans, for places that show no markup, such as meta tags.
 * @example $utils.plain('a `bongo/env` type') //=> 'a bongo/env type'
 */
export function plain(text: string): string {
	return text.replace(/`([^`]+)`/g, '$1');
}

/**
 * The source file of a docs page, relative to `docs/`: a `.hbs` file, else a `.md` file.
 * @example $utils.file('/releases/') //=> 'content/releases.hbs'
 */
export function file(path: string): string {
	let name = 'content/' + path.replace(/^\/|\/$/g, '');
	return existsSync(join(import.meta.dirname, name + '.hbs')) ? name + '.hbs' : name + '.md';
}

/**
 * The GitHub URL that edits the source of a docs page.
 * @example $utils.source('/templates/') //=> 'https://github.com/lukeed/bongo/edit/main/docs/content/templates.md'
 */
export function source(path: string): string {
	return `${REPO}/edit/main/docs/${file(path)}`;
}
