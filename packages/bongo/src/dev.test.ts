import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Message = { type: string; errors?: { message: string; file?: string }[] };
type Server = { url: string; messages: Message[]; page(): Promise<string>; stop(): Promise<void> };

const DEV = join(import.meta.dirname, 'dev.ts');

async function site(files: Record<string, string>): Promise<string> {
	let root = join(tmpdir(), `bongo-dev-${randomBytes(6).toString('hex')}`);
	for (let [rel, text] of Object.entries(files)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), text);
	}
	return root;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 8000): Promise<void> {
	let start = Date.now();
	while (!await check()) {
		if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
		await new Promise(r => setTimeout(r, 50));
	}
}

async function serve(root: string): Promise<Server> {
	let port = 5200 + Math.floor(Math.random() * 2000);
	let script = `import { dev } from ${JSON.stringify(DEV)}; await dev({ cwd: ${JSON.stringify(root)}, host: '127.0.0.1', port: ${port} });`;
	let proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });

	let output = '';
	let decoder = new TextDecoder();
	(async () => {
		for await (let chunk of proc.stdout) output += decoder.decode(chunk);
	})();
	await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(output) || proc.exitCode !== null, 'the dev server to start');
	let url = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
	if (!url) throw new Error(`dev did not start: ${output}${await new Response(proc.stderr).text()}`);

	let messages: Message[] = [];
	let abort = new AbortController();
	let events = await fetch(url + '/~/reload', { signal: abort.signal });
	(async () => {
		let reader = events.body?.getReader();
		let buffer = '';
		while (reader) {
			let { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
			if (done) return;
			buffer += decoder.decode(value);
			let parts = buffer.split('\n\n');
			buffer = parts.pop() ?? '';
			for (let part of parts) {
				let data = /^data: (\{.*\})$/m.exec(part);
				if (data) messages.push(JSON.parse(data[1]));
			}
		}
	})();

	return {
		url,
		messages,
		page: () => fetch(url + '/').then(res => res.text()),
		async stop() {
			abort.abort();
			proc.kill();
			await proc.exited;
		},
	};
}

const CONFIG = (title: string) => [
	`import { tagline } from './lib/meta';`,
	`export default { $site: { url: 'https://example.com/', title: ${JSON.stringify(title)} + ' ' + tagline, lang: 'en' }, $utils: { label: () => 'ok' } };`,
].join('\n');

describe('dev', () => {
	test('reloads when the config, a module it imports, or data/ changes', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG('A'),
			'lib/meta.ts': `export const tagline = 'one';`,
			'layouts/html.hbs': '<title>{{ $site.title }}</title><p>{{ $data.site ? $data.site.name : "none" }}</p>{{{ $page.content }}}',
			'content/index.html': '<main>home</main>',
		});
		let server = await serve(root);
		try {
			await until(async () => (await server.page()).includes('<title>A one</title><p>none</p>'), 'the first build');

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'two';`);
			await until(async () => (await server.page()).includes('<title>A two</title>'), 'an imported module edit');

			await writeFile(join(root, 'bongo.config.ts'), CONFIG('B'));
			await until(async () => (await server.page()).includes('<title>B two</title>'), 'a config edit');

			await mkdir(join(root, 'data'));
			await writeFile(join(root, 'data/site.json'), '{ "name": "first" }');
			await until(async () => (await server.page()).includes('<p>first</p>'), 'a new data/ folder');

			await writeFile(join(root, 'data/site.json'), '{ "name": "second" }');
			await until(async () => (await server.page()).includes('<p>second</p>'), 'a data edit');
			expect(server.messages.filter(m => m.type === 'error')).toEqual([]);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('a broken config shows the overlay and keeps the last good build serving', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG('A'),
			'lib/meta.ts': `export const tagline = 'one';`,
			'layouts/html.hbs': '<title>{{ $site.title }}</title><b>{{ $utils.label() }}</b>{{{ $page.content }}}',
			'content/index.html': '<main>home</main>',
			'content/about.html': '<main>about</main>',
		});
		let server = await serve(root);
		let good = '<title>A one</title><b>ok</b><main>home</main>';
		let errors = () => server.messages.filter(m => m.type === 'error');
		try {
			await until(async () => (await server.page()).includes(good), 'the first build');

			await writeFile(join(root, 'lib/meta.ts'), 'export const tagline = ;');
			await until(() => errors().length === 1, 'a syntax error in an imported module');
			expect(errors()[0].errors?.[0].file).toEndWith('lib/meta.ts');
			expect(await server.page()).toContain(good);

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'one';\nthrow new Error('meta is broken');`);
			await until(() => errors().length === 2, 'a config that throws');
			expect(errors()[1].errors?.[0].message).toContain('meta is broken');
			expect(await server.page()).toContain(good);

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'one';`);
			await writeFile(join(root, 'bongo.config.ts'), `export default { $site: { url: 'https://example.com/', title: 'C', lang: 'en' } };`);
			await until(() => errors().length === 3, 'a config that breaks the build');
			expect(await server.page()).toContain(good);
			expect(await fetch(server.url + '/about/').then(res => res.text())).toContain('<main>about</main>');

			await writeFile(join(root, 'bongo.config.ts'), CONFIG('D'));
			await until(async () => (await server.page()).includes('<title>D one</title><b>ok</b>'), 'the fixed config');
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
