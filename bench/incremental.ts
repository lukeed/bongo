import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { digest, mtimes, sample } from './measure';

import type { Sample } from './measure';

export type Step = { name: string; samples: Sample[]; written: number };

/** One change to the site, which the function that `apply` gives back undoes. */
export type Edit = { file?: string; change?: (text: string) => string };

/** The edits that `bongo build` runs after, from what reaches one page to what reaches all. */
export const EDITS = {
	'no change': {},
	'body edit': { file: 'content/s5/p50.md', change: text => text + '\nOne more line.\n' },
	'title edit': { file: 'content/s5/p51.md', change: text => text.replace(/^title: .*$/m, 'title: A New Title') },
	'new page': { file: 'content/s5/p100.md', change: () => '---\ntitle: A New Page\nsummary: One more page.\ndate: 2025-01-01\ntags: new\n---\n\nOne more page.\n' },
	'stylesheet edit': { file: 'assets/style.css', change: text => text + '\n.bench { color: red; }\n' },
	'layout edit': { file: 'layouts/html.hbs', change: text => text.replace('<main>', '<main class="m">') },
} satisfies Record<string, Edit>;

/**
 * Make `edit` in the site at `dir`, and give back a function that undoes it.
 * @example let undo = await apply('bench/site', EDITS['body edit']);
 */
export async function apply(dir: string, edit: Edit): Promise<() => Promise<void>> {
	if (!edit.file || !edit.change) return async () => {};
	let file = join(dir, edit.file);
	let was = await readFile(file, 'utf8').catch(() => undefined);
	let now = edit.change(was ?? '');
	if (now === was) throw new Error(`The edit does not change ${edit.file}`);
	await writeFile(file, now);
	return () => was === undefined ? rm(file) : writeFile(file, was);
}

/**
 * Run `bongo build` on the site at `dir` after each edit, `runs` times, from the output of a build without it.
 * Each step counts the files that its build wrote, and its last run must write the same bytes as a `--fresh` build.
 * @example let steps = await incremental.profile('bench/site', 5);
 */
export async function profile(dir: string, runs: number): Promise<Step[]> {
	let out = join(dir, 'public');
	let steps: Step[] = [];
	let written = async (build: () => Promise<Sample>): Promise<[Sample, number]> => {
		let before = await mtimes(out);
		let result = await build();
		let after = await mtimes(out);
		return [result, [...after].filter(([file, mtime]) => before.get(file) !== mtime).length];
	};

	await sample(dir, ['--fresh']);
	let fresh: Step = { name: 'fresh build', samples: [], written: 0 };
	for (let i = 0; i < runs; i++) [fresh.samples[i], fresh.written] = await written(() => sample(dir, ['--fresh']));
	steps.push(fresh);

	for (let [name, edit] of Object.entries(EDITS)) {
		let step: Step = { name, samples: [], written: 0 };
		for (let i = 0; i < runs; i++) {
			let undo = await apply(dir, edit);
			try {
				[step.samples[i], step.written] = await written(() => sample(dir));
				if (i === runs - 1) {
					let output = await digest(out);
					await sample(dir, ['--fresh']);
					if ((await digest(out)).sha !== output.sha) throw new Error(`${name}: the build wrote other bytes than a --fresh build`);
				}
			} finally {
				await undo();
			}
			if ('file' in edit) await sample(dir);
		}
		steps.push(step);
	}
	return steps;
}
