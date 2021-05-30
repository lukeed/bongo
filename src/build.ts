import * as views from './utils/views';
import { normalize } from './utils/argv';

import type { Argv } from 'ssg';

type Contents = Map<string, {
	input: string;
	output: string;
	content: string;
}>;

export async function build(argv: Argv) {
	argv = normalize(argv);
	console.log(argv);

	const { layouts, partials } = await views.collect(argv.cwd);

	console.log({ layouts });
	console.log({ partials });
}
