import * as http from './utils/http';
import { normalize } from './utils/argv';
import { build } from './build';

import type { Argv } from 'bongo';

export async function dev(argv: Argv) {
	argv.dev = true;
	await build(argv);

	const server = await http.start(argv as Required<Argv>);
	console.log('~> started', server.address());
}
