import type { Template } from 'bongo';

export type Link = {
	title: string;
	path: string;
	current: boolean;
};

export type Group = {
	title: string;
	color: string;
	pages: Link[];
};

export type Heading = {
	id: string;
	html: string;
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
 * @example $utils.nav($pages, $page.path) //=> [{ title: 'Start', color: 'sun', pages: [{ title: 'Introduction', path: '/docs/', current: true }] }]
 */
export function nav(pages: Template.PageInfo[], current: string): Group[] {
	return GROUPS.map(([title, color]) => ({
		title,
		color,
		pages: pages
			.filter(page => page.section === 'docs' && page.params.group === title)
			.toSorted((a, b) => Number(a.params.order) - Number(b.params.order))
			.map(page => ({ title: page.title, path: page.path, current: page.path === current })),
	}));
}

/**
 * The docs pages before and after the current one, in sidebar order.
 * @example $utils.pager($pages, '/docs/templates/') //=> { prev: { title: 'Frontmatter', … }, next: { title: 'Partials', … } }
 */
export function pager(pages: Template.PageInfo[], current: string): { prev?: Link; next?: Link } {
	let links = nav(pages, current).flatMap(group => group.pages);
	let index = links.findIndex(link => link.current);
	if (index === -1) return {};
	return { prev: links[index - 1], next: links[index + 1] };
}

/**
 * The `<h2>` headings of rendered content, for "On this page".
 * @example $utils.toc('<h2 id="styles">Styles</h2>') //=> [{ id: 'styles', html: 'Styles' }]
 */
export function toc(html: string): Heading[] {
	return Array.from(html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g), ([, id, inner]) => ({ id, html: inner }));
}

/**
 * The GitHub URL that edits the source of a docs page.
 * @example $utils.source('/docs/templates/') //=> 'https://github.com/lukeed/bongo/edit/main/docs/content/docs/templates.md'
 */
export function source(path: string): string {
	let slug = path.replace(/^\/docs\/?/, '').replace(/\/$/, '') || 'index';
	return `${REPO}/edit/main/docs/content/docs/${slug}.md`;
}
