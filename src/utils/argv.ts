import { resolve } from 'path';
import type { Argv } from 'ssg';

export function normalize(argv: Argv): Argv {
	let cwd = resolve(argv.cwd);
	return { cwd }
}
