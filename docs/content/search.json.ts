import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages
	.filter(page => page.section === 'docs')
	.map(page => ({
		title: page.title,
		path: page.path,
		group: page.params.group,
		summary: page.summary,
		headings: page.headings.filter(heading => heading.level === 2).map(heading => [heading.id, heading.text]),
	}));
