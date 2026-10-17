import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalize } from './argv';
import * as memo from './memo';

import type { Argv } from 'bongo';

async function project(): Promise<Required<Argv>> {
	let argv: Argv = { cwd: await mkdtemp(join(tmpdir(), 'bongo-memo-')) };
	normalize(argv);
	return argv;
}

function item(argv: Required<Argv>, path: string, placeholders: string[]): memo.Item {
	return {
		hash: memo.hash(path),
		kind: 'page',
		ext: 'html',
		params: { title: path, tags: 'a, b' },
		path,
		url: 'https://example.com' + path,
		output: join(argv.dest, path, 'index.html'),
		section: 'blog',
		tags: ['a', 'b'],
		headings: [
			{ level: 2, id: 'plain', text: 'Plain', html: 'Plain' },
			{ level: 2, id: 'code', text: 'The run() call', html: 'The <code>run()</code> call' },
		],
		record: memo.hash('record ' + path),
		draft: false,
		page: { reads: ['section'], loads: [], placeholders, inline: [], renders: [], found: [], stat: [120, 1700000000000.5] },
	};
}

describe('save and load', () => {
	test('give back the memo as it was', async () => {
		let argv = await project();
		let shared = ['__BONGO_BUNDLE:0000000000000001__', '__BONGO_BUNDLE:0000000000000002__'];
		let saved: memo.Memo = {
			key: 'k',
			registries: { pages: 'p', tags: 't', sections: { blog: 's' }, outputs: 'o' },
			bundles: { [shared[0]]: ['/site/assets/style.css', { kind: 'css' }] },
			assets: { [shared[0]]: [['/site/assets/style.css', 'h']] },
			marks: { [shared[0]]: ['l', ''] },
			loose: false,
			items: {
				'blog/a.md': item(argv, '/blog/a/', shared),
				'blog/b.md': item(argv, '/blog/b/', [...shared]),
				'blog/c.md': { ...item(argv, '/blog/c/', []), draft: true },
				'feed.xml.hbs': { ...item(argv, '/feed.xml', []), kind: 'output', output: join(argv.dest, 'feed.xml'), page: undefined },
			},
			files: { 'files/data.csv': ['h', join(argv.dest, 'files/data.csv'), 3, 1700000000000] },
			sources: { 'blog/a.md': [120, 1700000000000.5, 'h'] },
			made: ['blog/a/index.html', 'files/data.csv'],
		};
		try {
			await memo.save(argv, saved);
			let loaded = await memo.load(argv);
			expect(loaded).toEqual(saved);
			expect(loaded?.items['blog/a.md'].page?.placeholders).toBe(loaded?.items['blog/b.md'].page?.placeholders);
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});

	test('load nothing from a memo that other bongo code saved, or a broken one', async () => {
		let argv = await project();
		try {
			await memo.save(argv, { key: 'k', registries: { pages: '', tags: '', sections: {}, outputs: '' }, bundles: {}, assets: {}, marks: {}, loose: false, items: {}, files: {}, sources: {}, made: [] });
			let file = join(argv.cwd, 'node_modules/.cache/bongo/memo.json');
			let text = await Bun.file(file).text();
			await writeFile(file, text.replace(/"code":"[^"]+"/, '"code":"other"'));
			expect(await memo.load(argv)).toBeUndefined();
			await writeFile(file, text.slice(0, 20));
			expect(await memo.load(argv)).toBeUndefined();
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});
});
