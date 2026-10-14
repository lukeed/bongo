import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMeta } from 'md4x';

import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages
	.filter(page => page.section === 'docs')
	.map(page => {
		let slug = page.path.replace(/^\/docs\/?/, '').replace(/\/$/, '') || 'index';
		let meta = parseMeta(readFileSync(join(import.meta.dirname, 'docs', slug + '.md'), 'utf8'));
		return {
			title: page.title,
			path: page.path,
			group: page.params.group,
			summary: page.summary,
			headings: meta.headings.filter(heading => heading.level === 2).map(heading => [heading.id, heading.text]),
		};
	});
