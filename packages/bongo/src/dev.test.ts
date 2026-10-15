import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Message = { type: string; errors?: { message: string; file?: string }[] };
type Server = { url: string; messages: Message[]; output(): string; page(): Promise<string>; stop(): Promise<void> };

const DEV = join(import.meta.dirname, 'dev.ts');

async function site(files: Record<string, string>): Promise<string> {
	let root = join(tmpdir(), `bongo-dev-${randomBytes(6).toString('hex')}`);
	for (let [rel, text] of Object.entries(files)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), text);
	}
	return root;
}

async function until(check: () => boolean | Promise<boolean>, what: string, server?: Server, ms = 8000): Promise<void> {
	let start = Date.now();
	while (!await check()) {
		if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}\n${server?.output() ?? ''}`);
		await new Promise(r => setTimeout(r, 50));
	}
}

async function serve(root: string, write = false): Promise<Server> {
	let port = 5200 + Math.floor(Math.random() * 2000);
	let script = `import { dev } from ${JSON.stringify(DEV)}; await dev({ cwd: ${JSON.stringify(root)}, host: '127.0.0.1', port: ${port}, write: ${write} });`;
	let proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });

	let output = '';
	let decoder = new TextDecoder();
	(async () => {
		for await (let chunk of proc.stdout) output += decoder.decode(chunk);
	})();
	(async () => {
		for await (let chunk of proc.stderr) output += decoder.decode(chunk);
	})();
	await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(output) || proc.exitCode !== null, 'the dev server to start');
	let url = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
	if (!url) throw new Error(`dev did not start: ${output}`);

	let messages: Message[] = [];
	let ws = new WebSocket(url.replace(/^http/, 'ws') + '/~/reload');
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error(`the reload socket failed\n${output}`));
	});
	ws.onmessage = e => messages.push(JSON.parse(String(e.data)));

	return {
		url,
		messages,
		output: () => output,
		page: () => fetch(url + '/').then(res => res.text()),
		async stop() {
			ws.close();
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
	test('sees changes made during the first build, and turns a burst of changes into one rebuild', async () => {
		let files: Record<string, string> = {
			// the first render blocks for a while, so the test can edit files mid-build
			'bongo.config.ts': [
				`let first = true;`,
				`export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $utils: {`,
				`	hold() { if (first) { first = false; let end = Date.now() + 1500; while (Date.now() < end); } return ''; },`,
				`} };`,
			].join('\n'),
			'layouts/html.hbs': '{{ $utils.hold() }}{{{ $page.content }}}',
			'content/index.html': '<main>before</main>',
		};
		for (let i = 0; i < 40; i++) files[`content/p${i}.html`] = `<p>v1</p>`;
		let root = await site(files);
		let server = await serve(root);
		try {
			await new Promise(r => setTimeout(r, 600));
			await writeFile(join(root, 'content/index.html'), '<main>during</main>');
			await until(async () => (await server.page()).includes('<main>during</main>'), 'the edit made during the first build', server);

			let before = server.output().split('\n').filter(line => line.startsWith('[')).length;
			await Promise.all(Object.keys(files).filter(rel => rel.startsWith('content/p')).map(rel => writeFile(join(root, rel), '<p>v2</p>')));
			await until(async () => (await fetch(server.url + '/p39/').then(res => res.text())).includes('v2'), 'the burst of edits', server);
			await new Promise(r => setTimeout(r, 1000));
			let rebuilds = server.output().split('\n').filter(line => line.startsWith('[')).length - before;
			expect(rebuilds).toBeLessThanOrEqual(2);
			expect(await fetch(server.url + '/p0/').then(res => res.text())).toContain('v2');
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('reloads when the config, a module it imports, or data/ changes', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG('A'),
			'lib/meta.ts': `export const tagline = 'one';`,
			'layouts/html.hbs': '<title>{{ $site.title }}</title><p>{{ $data.site ? $data.site.name : "none" }}</p>{{{ $page.content }}}',
			'content/index.html': '<main>home</main>',
		});
		let server = await serve(root);
		try {
			await until(async () => (await server.page()).includes('<title>A one</title><p>none</p>'), 'the first build', server);

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'two';`);
			await until(async () => (await server.page()).includes('<title>A two</title>'), 'an imported module edit', server);

			await writeFile(join(root, 'bongo.config.ts'), CONFIG('B'));
			await until(async () => (await server.page()).includes('<title>B two</title>'), 'a config edit', server);

			await mkdir(join(root, 'data'));
			await writeFile(join(root, 'data/site.json'), '{ "name": "first" }');
			await until(async () => (await server.page()).includes('<p>first</p>'), 'a new data/ folder', server);

			await writeFile(join(root, 'data/site.json'), '{ "name": "second" }');
			await until(async () => (await server.page()).includes('<p>second</p>'), 'a data edit', server);
			expect(server.messages.filter(m => m.type === 'error')).toEqual([]);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('reloads when a package linked from outside node_modules changes', async () => {
		let root = await site({
			'pkgs/linked/package.json': JSON.stringify({ name: 'linked', type: 'module', exports: './index.js' }),
			'pkgs/linked/index.js': `export const tagline = () => 'one';`,
			'site/bongo.config.ts': `import { tagline } from 'linked';\nexport default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, $utils: { tagline } };`,
			'site/layouts/html.hbs': '<p>{{ $utils.tagline() }}</p>{{{ $page.content }}}',
			'site/content/index.html': '<main>home</main>',
		});
		await mkdir(join(root, 'site/node_modules'));
		await symlink(join(root, 'pkgs/linked'), join(root, 'site/node_modules/linked'));
		let server = await serve(join(root, 'site'));
		try {
			await until(async () => (await server.page()).includes('<p>one</p>'), 'the first build', server);
			await writeFile(join(root, 'pkgs/linked/index.js'), `export const tagline = () => 'two';`);
			await until(async () => (await server.page()).includes('<p>two</p>'), 'a linked package edit', server);
			expect(server.messages.filter(m => m.type === 'error')).toEqual([]);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('runs a data module again when a page, the module, or a file it imports changes', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
			'lib/prefix.ts': `export const prefix = 'v1';`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '---\ntitle: Home\n---\n<main>home</main>',
			'content/titles.json.ts': `import { prefix } from '../lib/prefix';\nexport default ({ $pages }: Record<string, any>) => $pages.map((p: { title: string }) => prefix + ':' + p.title);`,
		});
		let server = await serve(root);
		let json = () => fetch(server.url + '/titles.json').then(res => res.text());
		try {
			await until(async () => await json() === '["v1:Home"]', 'the first build', server);
			let res = await fetch(server.url + '/titles.json');
			expect(res.headers.get('content-type')).toContain('application/json');

			await writeFile(join(root, 'content/index.html'), '---\ntitle: Start\n---\n<main>home</main>');
			await until(async () => await json() === '["v1:Start"]', 'a page edit', server);

			await writeFile(join(root, 'lib/prefix.ts'), `export const prefix = 'v2';`);
			await until(async () => await json() === '["v2:Start"]', 'an imported module edit', server);

			await writeFile(join(root, 'content/titles.json.ts'), `export default ['edited'];`);
			await until(async () => await json() === '["edited"]', 'a module edit', server);
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
		let seen = 0;
		let next = async (match: (error: { message: string; file?: string }) => boolean, what: string) => {
			let from = seen;
			await until(() => errors().slice(from).some(m => m.errors?.some(match)), what, server);
			seen = errors().length;
		};
		try {
			await until(async () => (await server.page()).includes(good), 'the first build', server);

			await writeFile(join(root, 'lib/meta.ts'), 'export const tagline = ;');
			await next(error => !!error.file?.endsWith('lib/meta.ts') && error.message.includes('Unexpected token'), 'a syntax error in an imported module');
			expect(await server.page()).toContain(good);

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'one';\nthrow new Error('meta is broken');`);
			await next(error => error.message.includes('meta is broken'), 'a config that throws');
			expect(await server.page()).toContain(good);

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'one';`);
			await writeFile(join(root, 'bongo.config.ts'), `export default { $site: { url: 'https://example.com/', title: 'C', lang: 'en' } };`);
			await next(error => error.message.includes('label'), 'a config that breaks the build');
			expect(await server.page()).toContain(good);
			expect(await fetch(server.url + '/about/').then(res => res.text())).toContain('<main>about</main>');

			await writeFile(join(root, 'bongo.config.ts'), CONFIG('D'));
			await until(async () => (await server.page()).includes('<title>D one</title><b>ok</b>'), 'the fixed config', server);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});

describe('a failed first build', () => {
	test('keeps the server up, serves the error with the overlay, and reloads when a fix builds', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.hbs': '<main>{{ $utils.nope() }}</main>',
		});
		let server = await serve(root);
		try {
			let res = await fetch(server.url + '/');
			expect(res.status).toBe(500);
			expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
			let html = await res.text();
			expect(html).toContain('__bongo_err([{"message":');
			expect(html).toContain('nope');
			expect(html).toContain(`/~/reload?id=`);
			expect((await fetch(server.url + '/about/')).status).toBe(500);

			await writeFile(join(root, 'content/index.hbs'), '<main>fixed</main>');
			await until(async () => (await server.page()).includes('<main>fixed</main>'), 'the fix', server);
			expect(server.messages.some(m => m.type === 'reload')).toBe(true);
			expect((await fetch(server.url + '/about/')).status).toBe(404);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test('keeps the server up when the config is broken, and builds when the config is fixed', async () => {
		let root = await site({
			'bongo.config.ts': CONFIG('A'),
			'lib/meta.ts': `export const tagline = ;`,
			'layouts/html.hbs': '<title>{{ $site.title }}</title>{{{ $page.content }}}',
			'content/index.html': '<main>home</main>',
		});
		let server = await serve(root);
		try {
			let res = await fetch(server.url + '/');
			expect(res.status).toBe(500);
			expect(await res.text()).toContain('lib/meta.ts');

			await writeFile(join(root, 'lib/meta.ts'), `export const tagline = 'one';`);
			await until(async () => (await server.page()).includes('<title>A one</title><main>home</main>'), 'the fixed config', server);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});

describe('output files', () => {
	test('are served with the type of their extension, and render again when any page changes', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '<p>home</p>',
			'content/blog/post.html': '---\ntitle: First\n---\n<p>post</p>',
			'content/blog/index.xml.hbs': '<?xml version="1.0"?>\n<list>{{#each $section as p}}<t>{{ p.title }}</t>{{/each}}</list>',
			'content/robots.txt.hbs': 'Sitemap: {{ $site.url }}sitemap.xml',
		});
		let server = await serve(root);
		let feed = () => fetch(server.url + '/blog/index.xml').then(res => res.text());
		let post = join(root, 'content/blog/post.html');
		try {
			await until(async () => (await feed()).includes('<t>First</t>'), 'the first build', server);
			let res = await fetch(server.url + '/blog/index.xml');
			expect(res.headers.get('content-type')).toBe('text/xml; charset=utf-8');
			expect(await res.text()).toBe('<?xml version="1.0"?>\n<list><t>First</t></list>');
			let txt = await fetch(server.url + '/robots.txt');
			expect(txt.headers.get('content-type')).toBe('text/plain; charset=utf-8');
			expect(await txt.text()).toBe('Sitemap: https://example.com/sitemap.xml');

			await writeFile(post, '---\ntitle: Second\n---\n<p>post</p>');
			await until(async () => (await feed()).includes('<t>Second</t>'), 'a title edit', server);

			await writeFile(post, '---\ntitle: Second\n---\n<p>edited</p>');
			await until(async () => (await fetch(server.url + '/blog/post/').then(res => res.text())).includes('edited'), 'a body edit', server);
			expect(await feed()).toBe('<?xml version="1.0"?>\n<list><t>Second</t></list>');
			expect(server.messages.filter(m => m.type === 'error')).toEqual([]);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});

describe('$assets.render', () => {
	test('serves a render on its first request, and stops serving one that no page makes any more', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'partials/card.hbs': '<div style="display: flex; width: 100%; height: 100%; background: red"></div>',
			'content/index.hbs': `<p>{{ await $assets.render('card', 'og/a.png') }}</p>`,
		});
		let server = await serve(root);
		try {
			await until(async () => (await server.page()).includes('<p>/og/a.png</p>'), 'the first build', server);
			let res = await fetch(server.url + '/og/a.png');
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');

			await writeFile(join(root, 'content/index.hbs'), `<p>{{ await $assets.render('card', 'og/b.png') }}</p>`);
			await until(async () => (await server.page()).includes('<p>/og/b.png</p>'), 'the edit', server);
			expect((await fetch(server.url + '/og/a.png')).status).toBe(404);
			expect((await fetch(server.url + '/og/b.png')).status).toBe(200);
			expect(server.messages.filter(m => m.type === 'error')).toEqual([]);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});

describe('output folder', () => {
	test('holds requests made during the first build until it ends', async () => {
		let root = await site({
			'bongo.config.ts': `await new Promise(r => setTimeout(r, 1500));\nexport default { $site: { url: 'https://example.com/', title: 'x', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '<p>home</p>',
		});
		let server = await serve(root);
		try {
			let res = await fetch(server.url + '/');
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('<p>home</p>');
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	});

	test('dev keeps its output in memory: public/ stays as it is, and its files are never served', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'x', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '<p>home</p>',
			'public/index.html': 'stale',
			'public/old/stale.html': 'old',
		});
		let server = await serve(root);
		try {
			await until(async () => (await server.page()).includes('<p>home</p>'), 'the first build', server);
			expect((await fetch(server.url + '/old/stale.html')).status).toBe(404);
			expect((await readdir(join(root, 'public'))).sort()).toEqual(['index.html', 'old']);
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('stale');
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	});

	test('dev --write also writes its output to public/, as dev did before', async () => {
		let root = await site({
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'x', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '<p>home</p>',
			'public/old/stale.html': 'old',
		});
		let server = await serve(root, true);
		try {
			await until(async () => (await server.page()).includes('<p>home</p>'), 'the first build', server);
			expect(await readdir(join(root, 'public'))).toEqual(['index.html']);
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toContain('__bongo_ws');
			await writeFile(join(root, 'content/index.html'), '<p>edited</p>');
			await until(async () => (await readFile(join(root, 'public/index.html'), 'utf8')).includes('<p>edited</p>'), 'the mirrored edit', server);
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a build that runs at the same time neither breaks dev nor gets dev pages', async () => {
		let files: Record<string, string> = {
			'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'x', lang: 'en' } };`,
			'layouts/html.hbs': '{{{ $page.content }}}',
			'content/index.html': '<p>home</p>',
		};
		for (let i = 0; i < 150; i++) files[`content/p${i}.html`] = `<p>${i}</p>`;
		let root = await site(files);
		let server = await serve(root);
		try {
			await until(async () => (await server.page()).includes('<p>home</p>'), 'the first build', server);
			let script = `import { build } from ${JSON.stringify(join(import.meta.dirname, 'build.ts'))}; await build({ cwd: ${JSON.stringify(root)} });`;
			let proc = Bun.spawn(['bun', '-e', script], { stdout: 'ignore', stderr: 'pipe' });
			let statuses: number[] = [];
			while (proc.exitCode === null) {
				statuses.push((await fetch(server.url + '/p99/')).status);
				await new Promise(r => setTimeout(r, 5));
			}
			expect(await proc.exited).toBe(0);
			expect(statuses.length).toBeGreaterThan(0);
			expect([...new Set(statuses)]).toEqual([200]);
			expect(await server.page()).toContain('__bongo_ws');

			await writeFile(join(root, 'content/index.html'), '<p>edited</p>');
			await until(async () => (await server.page()).includes('<p>edited</p>'), 'the edit', server);
			let built = await readFile(join(root, 'public/index.html'), 'utf8');
			expect(built).toBe('<p>home</p>');
		} finally {
			await server.stop();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
