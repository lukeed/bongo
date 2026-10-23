import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pkg from '../package.json';

const BIN = join(import.meta.dirname, '../bin.js');

async function run(args: string[], env = process.env): Promise<{ code: number; out: string }> {
	let proc = Bun.spawn(['node', BIN, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
	let [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { code: await proc.exited, out: out + err };
}

async function site(): Promise<string> {
	let root = join(tmpdir(), `bongo-cli-${randomBytes(6).toString('hex')}`);
	await mkdir(join(root, 'content'), { recursive: true });
	await mkdir(join(root, 'layouts'), { recursive: true });
	await writeFile(join(root, 'bongo.config.mjs'), `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`);
	await writeFile(join(root, 'layouts/html.hbs'), '{{{ $page.content }}}');
	await writeFile(join(root, 'content/index.html'), '<p>home</p>');
	return root;
}

// Starts `bongo dev` and resolves with its banner, then stops it.
async function banner(args: string[]): Promise<string> {
	let proc = Bun.spawn(['node', BIN, 'dev', ...args], { stdout: 'pipe', stderr: 'pipe' });
	let out = '';
	let reader = proc.stdout.getReader();
	let end = Date.now() + 15_000;
	while (!/➜ {2}Network/.test(out) && Date.now() < end) {
		let { value, done } = await reader.read();
		if (done) break;
		out += new TextDecoder().decode(value);
	}
	proc.kill();
	await proc.exited;
	return out;
}

// A port that is free now, from the OS, so a test never guesses one that another program holds.
async function port(): Promise<number> {
	let server = createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	let address = server.address();
	await new Promise(resolve => server.close(resolve));
	if (!address || typeof address === 'string') throw new Error('no free port');
	return address.port;
}

describe('bongo cli', () => {
	test('prints its version and its help', async () => {
		expect((await run(['-v'])).out.trim()).toBe(`${pkg.name}, v${pkg.version}`);
		let help = await run(['--help']);
		expect(help.code).toBe(0);
		expect(help.out).toContain('bongo <command> [options]');
		expect(help.out).toContain('-p, --port');
		expect(help.out).toContain('--drafts     Build drafts; --no-drafts leaves them out');
	});

	test('fails on an unknown option, a port that is not a number, or a missing command', async () => {
		let unknown = await run(['build', '--nope']);
		expect(unknown.code).toBe(1);
		expect(unknown.out).toContain(`Unknown option '--nope'`);

		let bad = await run(['dev', '--port', 'abc']);
		expect(bad.code).toBe(1);
		expect(bad.out).toContain('Invalid --port "abc"; use a port number');

		let none = await run([]);
		expect(none.code).toBe(1);
		expect(none.out).toContain('Missing <command> argument');
	});

	test('builds the site that -C names, with the flags it gets', async () => {
		let root = await site();
		try {
			let { code, out } = await run(['build', '-C', root, '-m', '--debug']);
			expect(code).toBe(0);
			expect(existsSync(join(root, 'public/index.html'))).toBe(true);
			expect(out).toContain('[DEBUG]');
			expect(out).toMatch(/minify: true/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('sets NODE_ENV before it loads the config', async () => {
		let root = await site();
		try {
			await writeFile(join(root, 'mode.mjs'), `export const mode = process.env.NODE_ENV;`);
			await writeFile(join(root, 'bongo.config.mjs'), `import { mode } from './mode.mjs';\nexport default { $site: { url: 'https://example.com/', title: String(mode), lang: 'en' } };`);
			await writeFile(join(root, 'layouts/html.hbs'), '{{ $site.title }}');
			let env = { ...process.env };
			delete env.NODE_ENV;
			let { code, out } = await run(['build', '-C', root], env);
			if (code !== 0) throw new Error(out);
			expect(await Bun.file(join(root, 'public/index.html')).text()).toBe('production');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('builds a draft only with --drafts', async () => {
		let root = await site();
		try {
			await writeFile(join(root, 'content/wip.html'), '---\ndraft: true\n---\n<p>wip</p>');
			let built = [];
			for (let flags of [[], ['--drafts'], ['--no-drafts']]) {
				let { code, out } = await run(['build', '-C', root, ...flags]);
				if (code !== 0) throw new Error(out);
				built.push(existsSync(join(root, 'public/wip/index.html')));
			}
			expect(built).toEqual([false, true, false]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('dev takes a host and a port, and a bare --host exposes the server', async () => {
		let root = await site();
		try {
			let local = await port();
			let out = await banner(['-C', root, '-H', '127.0.0.1', '-p', String(local)]);
			expect(out).toContain(`http://127.0.0.1:${local}/`);
			expect(out).toContain('use `--host` to expose');

			let open = await port();
			for (let args of [['--host', '--port', String(open)], ['--port', String(open), '--host']]) {
				out = await banner(['-C', root, ...args]);
				expect(out).toContain(`http://localhost:${open}/`);
				expect(out).not.toContain('use `--host` to expose');
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 60_000);

	test('dev moves to the next free port when its port is taken', async () => {
		let root = await site();
		let blocker = createServer();
		await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
		let address = blocker.address();
		if (!address || typeof address === 'string') throw new Error('no free port');
		let taken = address.port;
		try {
			let out = await banner(['-C', root, '-H', '127.0.0.1', '--port', String(taken)]);
			// another process may hold the port above it, so dev may move further, up to 10 ports
			let port = Number(out.match(/http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]);
			expect(port).toBeGreaterThan(taken);
			expect(port).toBeLessThanOrEqual(taken + 10);
		} finally {
			blocker.close();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
