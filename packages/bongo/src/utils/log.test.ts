import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { gzipSync } from 'node:zlib';

import * as log from './log';

let spy = spyOn(console, 'log').mockImplementation(() => {});
let lines = () => spy.mock.calls.map(args => stripVTControlCharacters(args.join(' ')));
let wait = (ms: number) => new Promise(r => setTimeout(r, ms));

afterEach(() => spy.mockClear());

describe('watchdog', () => {
	test('names the stage that is still running, so a stall is never silent', async () => {
		let watch = log.watchdog({ every: 50 });
		watch.step('loading config');
		await wait(70);
		watch.step('bundling assets');
		await wait(120);
		watch.stop();
		expect(lines()).toEqual([
			expect.stringMatching(/^~> still loading config \(\d+ms\)$/),
			expect.stringMatching(/^~> still bundling assets \(\d+ms\)$/),
			expect.stringMatching(/^~> still bundling assets \(\d+ms\)$/),
		]);
	});

	test('is silent once stopped', async () => {
		let watch = log.watchdog({ every: 30 });
		watch.step('rendering pages');
		watch.stop();
		await wait(100);
		expect(lines()).toEqual([]);
	});

	test('logs each step and its time under --debug', async () => {
		let watch = log.watchdog({ debug: true });
		watch.step('loading config');
		watch.step('rendering pages');
		watch.stop();
		expect(lines()).toEqual([
			'[DEBUG] [stage] loading config',
			expect.stringMatching(/^\[DEBUG\] \[stage\] loading config: \d+ms$/),
			'[DEBUG] [stage] rendering pages',
			expect.stringMatching(/^\[DEBUG\] \[stage\] rendering pages: \d+ms$/),
		]);
	});
});

describe('sizes', () => {
	async function report(files: Record<string, string>): Promise<string[]> {
		let root = await mkdtemp(join(tmpdir(), 'bongo-sizes-'));
		try {
			for (let [rel, data] of Object.entries(files)) {
				await mkdir(dirname(join(root, 'public', rel)), { recursive: true });
				await writeFile(join(root, 'public', rel), data);
			}
			await log.sizes(join(root, 'public'), root, Object.keys(files).map(rel => join(root, 'public', rel)));
			return lines();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}

	let gz = (text: string) => gzipSync(text).length + ' B';

	test('lists each file, with its size and gzip size, for 50 files or fewer', async () => {
		let js = 'let a = 1;';
		let html = '<p>home</p>';
		let blog = 'x'.repeat(1500);
		expect(await report({ 'index.html': html, 'blog/index.html': blog, 'app.js': js })).toEqual([
			'',
			'  public/',
			`    app.js             10 B  │ ${gz(js)}`,
			`    blog/index.html  1.50 kB │ ${gz(blog)}`,
			`    index.html         11 B  │ ${gz(html)}`,
			'',
		]);
	});

	test('groups the files by extension above 50 files, and lists each script and stylesheet', async () => {
		let pages = Object.fromEntries(Array.from({ length: 59 }, (_, i) => [`p${i}/index.html`, 'x'.repeat(100)]));
		let js = 'let a = 1;';
		let css = 'b { color: red }';
		expect(await report({ ...pages, 'app.js': js, 'style.css': css, '_headers': '/*\n  X: y\n' })).toEqual([
			'',
			'  public/  62 files · 5.94 kB',
			'    .html      5.90 kB 59 files',
			'    _headers     10 B  1 file',
			`    app.js       10 B  │ ${gz(js)}`,
			`    style.css    16 B  │ ${gz(css)}`,
			'',
		]);
	});
});
