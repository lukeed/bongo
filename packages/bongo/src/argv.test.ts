import { describe, expect, test } from 'bun:test';
import { normalize } from './utils/argv';
import { resolve } from 'node:path';

describe('normalize', () => {
	test('resolves cwd to absolute path', () => {
		let argv: any = { cwd: '.' };
		normalize(argv);
		expect(argv.cwd).toBe(resolve('.'));
	});

	test('sets default paths relative to cwd', () => {
		let cwd = '/tmp/test-project';
		let argv: any = { cwd };
		normalize(argv);

		expect(argv.src).toBe(resolve(cwd, '.'));
		expect(argv.dest).toBe(resolve(cwd, 'public'));
		expect(argv.assets).toBe(resolve(cwd, 'assets'));
		expect(argv.content).toBe(resolve(cwd, 'content'));
		expect(argv.partials).toBe(resolve(cwd, 'partials'));
		expect(argv.layouts).toBe(resolve(cwd, 'layouts'));
	});

	test('resolves custom src directory', () => {
		let cwd = '/tmp/test-project';
		let argv: any = { cwd, src: 'site' };
		normalize(argv);

		expect(argv.src).toBe(resolve(cwd, 'site'));
		expect(argv.assets).toBe(resolve(cwd, 'site', 'assets'));
		expect(argv.content).toBe(resolve(cwd, 'site', 'content'));
	});

	test('defaults each flag to false, so the CLI and the API give one memo key', () => {
		let argv: any = { cwd: '/tmp' };
		normalize(argv);
		expect(argv.debug).toBe(false);
		expect(argv.dev).toBe(false);
		expect(argv.fresh).toBe(false);
		expect(argv.minify).toBe(false);
		expect(argv.write).toBe(false);
	});

	test('leaves drafts out of a build and in dev, unless set', () => {
		let build: any = { cwd: '/tmp' };
		let dev: any = { cwd: '/tmp', dev: true };
		let both: any[] = [{ cwd: '/tmp', drafts: true }, { cwd: '/tmp', dev: true, drafts: false }];
		for (let argv of [build, dev, ...both]) normalize(argv);
		expect([build.drafts, dev.drafts, both[0].drafts, both[1].drafts]).toEqual([false, true, true, false]);
	});

	test('preserves truthy debug and dev', () => {
		let argv: any = { cwd: '/tmp', debug: true, dev: true };
		normalize(argv);
		expect(argv.debug).toBe(true);
		expect(argv.dev).toBe(true);
	});

	test('defaults port to 3000 and host to localhost', () => {
		let argv: any = { cwd: '/tmp' };
		normalize(argv);
		expect(argv.port).toBe(3000);
		expect(argv.host).toBe('localhost');
	});

	test('preserves custom port and host', () => {
		let argv: any = { cwd: '/tmp', port: 8080, host: '0.0.0.0' };
		normalize(argv);
		expect(argv.port).toBe(8080);
		expect(argv.host).toBe('0.0.0.0');
	});
});
