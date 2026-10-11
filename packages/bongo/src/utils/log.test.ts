import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';

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
