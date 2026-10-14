import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pkg from '../package.json';

const BIN = join(import.meta.dirname, '../bin.js');

async function run(args: string[]): Promise<{ code: number; out: string }> {
	let proc = Bun.spawn(['node', BIN, ...args], { stdout: 'pipe', stderr: 'pipe' });
	let [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { code: await proc.exited, out: out + err };
}

describe('create-bongo cli', () => {
	test('prints its version and its help', async () => {
		expect((await run(['--version'])).out.trim()).toBe(`${pkg.name}, v${pkg.version}`);
		expect((await run(['-h'])).out).toContain('bun create bongo <name> [options]');
	});

	test('creates the site in the folder that -C names, and needs --force to write over it', async () => {
		let dir = await mkdtemp(join(tmpdir(), 'create-bongo-'));
		try {
			let made = await run(['my', 'site', '-C', dir]);
			expect(made.code).toBe(0);
			expect(made.out).toContain('Created');
			expect(JSON.parse(await readFile(join(dir, 'my-site/package.json'), 'utf8'))).toHaveProperty('scripts');
			expect(existsSync(join(dir, 'my-site/.gitignore'))).toBe(true);

			let again = await run(['my-site', '--cwd', dir]);
			expect(again.code).toBe(1);
			expect(again.out).toContain('Refusing to overwrite');

			expect((await run(['my-site', '--cwd', dir, '-f'])).code).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 30_000);

	test('fails on an unknown option or a missing name', async () => {
		let unknown = await run(['site', '--nope']);
		expect(unknown.code).toBe(1);
		expect(unknown.out).toContain(`Unknown option '--nope'`);
		let none = await run([]);
		expect(none.code).toBe(1);
		expect(none.out).toContain('Missing <name> argument');
	});
});
