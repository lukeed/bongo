import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages
	.filter(page => page.section === 'blog')
	.map(page => ({ title: page.title, path: page.path }));
