/**
 * BUILD BONGO FILES
 */

import { dirname, join, resolve } from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

import { rolldown } from 'rolldown';

const argv = process.argv.slice(2);

const SRC = dirname(
	fileURLToPath(import.meta.url)
);

const SPACER = '  ';
const MAX_FILE = 22;
const MAX_SIZE = 10;
const COLUMNS = SPACER.length*3 + MAX_FILE + MAX_SIZE;

async function write(file: string, data: Uint8Array|string) {
	// let abs = resolve(file);
	let abs = join(SRC, file);

	let dir = dirname(abs);
	existsSync(dir) || await fs.mkdir(dir);
	await fs.writeFile(abs, data);

	let b = data.length;
	let num = b < 1024
		? b.toLocaleString() + ' B '
		: (b / 1024).toFixed(2) + ' kB';

	let text = SPACER + file.padEnd(MAX_FILE);
	text += SPACER + num.padStart(MAX_SIZE);
	console.log(text + SPACER);
}

function title(str: string) {
	let b = '-'.repeat((COLUMNS - str.length - 1) / 2);
	b = `${b} ${str} ${b}`.substring(0, COLUMNS);
	console.log('\n' + b + '\n');
}

function time(sec: number, ns: number): string {
	let num = Math.round(ns / 1e6);

	if (sec < 1) return num + 'ms';
	return (sec + num / 1e3).toFixed(2) + 's';
}

function timer() {
	let now = process.hrtime();
	return () => {
		let done = time(...process.hrtime(now));
		console.log('\n' + `Done in ${done}`.padStart(COLUMNS) + '\n~~~~\n');
	};
}

async function bundle(input: string, output: string) {
	const isMIN = !argv.includes('--dev');
	const format = /\.mjs$/.test(output) ? 'esm' : 'cjs';

	const external = [
		/^node:/,
		/^rolldown/,
		/^mrmime/,
		/^markdown-it/,
		/^tempura/,
		...builtinModules.map(m => new RegExp(`^${m}$`)),
	];

	let b = await rolldown({
		input: join(SRC, input),
		external,
		resolve: {
			conditionNames: ['import', 'node'],
			mainFields: ['module', 'main'],
		},
	});

	let result = await b.generate({
		format: format as 'es' | 'cjs',
		minify: isMIN,
	});

	let outdir = dirname(output);
	for (let c of result.output) {
		let file = join(outdir, c.fileName);
		if (c.type === 'asset') {
			await write(file, c.source);
		} else {
			await write(file, c.code);
		}
	}
}

// ------------

let clock = timer();

title('Core');
await bundle('bin.ts', 'bin.mjs');

title('Plugin: markdown'); // splitting=false, format=cjs
await bundle('plugins/markdown.ts', 'plugins/markdown.mjs');

clock(); //-> logs
