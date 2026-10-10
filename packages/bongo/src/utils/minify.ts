import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BATCH = 200;

/**
 * Minify HTML files in place with tdewolff's `minify` CLI, when it is on PATH.
 * Resolves `false`, changing nothing, when the CLI is missing.
 * @example await minify.html(['public/index.html'])
 */
export async function html(files: string[]): Promise<boolean> {
	try {
		await run('minify', ['--version']);
	} catch {
		return false;
	}
	for (let i = 0; i < files.length; i += BATCH) {
		await run('minify', ['-q', '-i', ...files.slice(i, i + BATCH)]);
	}
	return true;
}
