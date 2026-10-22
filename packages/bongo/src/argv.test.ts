import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { normalize } from './utils/argv';

describe('normalize', () => {
	test('resolves cwd to absolute path', () => {
		let argv: any = { cwd: '.' };
		normalize(argv);
		expect(argv.cwd).toBe(resolve('.'));
	});

	test('resolves the symlinks of cwd, so its paths match the real paths of modules', () => {
		let dir = realpathSync(mkdtempSync(join(tmpdir(), 'bongo-argv-')));
		try {
			symlinkSync(dir, dir + '-link');
			let argv = { cwd: dir + '-link' };
			normalize(argv);
			expect(argv.cwd).toBe(dir);
			let missing = { cwd: join(dir + '-link', 'new') };
			normalize(missing);
			expect(missing.cwd).toBe(join(dir, 'new'));
		} finally {
			rmSync(dir + '-link', { force: true });
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('sets default paths relative to cwd', () => {
		let cwd = join(realpathSync(tmpdir()), 'test-project');
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
		let cwd = join(realpathSync(tmpdir()), 'test-project');
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
