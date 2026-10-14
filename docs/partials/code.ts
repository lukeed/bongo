import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import * as code from '../code';

/**
 * Highlight a file from `snippets/` for the home page.
 * @example {{#partial src="code" file="bongo.config.ts"}}
 */
export default function (args: { file: string }): string {
	let source = readFileSync(join(import.meta.dirname, '../snippets', args.file), 'utf8');
	return code.highlight(source.replace(/\n$/, ''), extname(args.file).slice(1));
}
