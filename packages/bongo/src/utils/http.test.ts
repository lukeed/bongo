import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';


import * as http from './http';
import * as images from './images';

import type { Argv } from 'bongo';
import type { HmrMessage } from './bundler';

function argv(): Required<Argv> {
	let dest = mkdtempSync(join(tmpdir(), 'bongo-http-'));
	writeFileSync(join(dest, 'index.html'), '<h1>ok</h1>');
	return { dest, host: '127.0.0.1', port: 4900 + Math.floor(Math.random() * 900) } as Required<Argv>;
}

function raw(port: number, payload: string, wait = 150): Promise<string> {
	return new Promise((resolve, reject) => {
		let out = '';
		let socket = connect(port, '127.0.0.1', () => socket.write(payload));
		socket.on('data', chunk => out += chunk);
		socket.on('error', reject);
		setTimeout(() => {
			socket.destroy();
			resolve(out);
		}, wait);
	});
}

function socket(port: number, id = http.ID): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		let ws = new WebSocket(`ws://127.0.0.1:${port}${http.RELOAD}?id=${id}`);
		ws.onopen = () => resolve(ws);
		ws.onerror = () => reject(new Error('reload socket failed'));
	});
}

function next(ws: WebSocket): Promise<unknown> {
	return new Promise(resolve => {
		ws.addEventListener('message', e => resolve(JSON.parse(String(e.data))), { once: true });
	});
}

describe('send', () => {
	test('sends every message to every reload socket, whatever its size', async () => {
		let opts = argv();
		let server = await http.start(opts);
		let a = await socket(opts.port);
		let b = await socket(opts.port);
		try {
			for (let size of [10, 200, 70_000]) {
				let msg: HmrMessage = { type: 'error', errors: [{ message: 'x'.repeat(size) }] };
				let got = Promise.all([next(a), next(b)]);
				http.send(msg);
				expect(await got).toEqual([msg, msg]);
			}
		} finally {
			a.close();
			b.close();
			server.close();
		}
	});

	test('reloads a page that a previous server run rendered, and leaves a reconnect alone', async () => {
		let opts = argv();
		let server = await http.start(opts);
		let stale = await socket(opts.port, 'earlier-run');
		let reload = next(stale);
		let fresh = await socket(opts.port);
		try {
			let got: unknown[] = [];
			fresh.onmessage = e => got.push(JSON.parse(String(e.data)));
			expect(await reload).toEqual({ type: 'reload' });
			await new Promise(r => setTimeout(r, 100));
			expect(got).toEqual([]);
		} finally {
			stale.close();
			fresh.close();
			server.close();
		}
	});

	test('answers a closing client with a clean close', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			let ws = await socket(opts.port);
			let closed = new Promise<number>(resolve => ws.onclose = e => resolve(e.code));
			ws.close(1000);
			expect(await closed).toBe(1000);
		} finally {
			server.close();
		}
	});

	test('refuses a plain request to the reload path', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			let res = await fetch(`http://127.0.0.1:${opts.port}${http.RELOAD}`);
			expect(res.status).toBe(426);
		} finally {
			server.close();
		}
	});
});

describe('404', () => {
	async function serve(files: Record<string, string>, run: (url: string) => Promise<void>): Promise<void> {
		let opts = argv();
		for (let [rel, text] of Object.entries(files)) {
			mkdirSync(dirname(join(opts.dest, rel)), { recursive: true });
			writeFileSync(join(opts.dest, rel), text);
		}
		let server = await http.start(opts);
		try {
			await run(`http://127.0.0.1:${opts.port}`);
		} finally {
			server.close();
		}
	}

	test('serves real routes with and without a trailing slash', async () => {
		await serve({ 'about/index.html': '<h1>about</h1>' }, async url => {
			for (let path of ['/', '/about', '/about/', '/about/?x=1']) {
				let res = await fetch(url + path);
				expect(res.status).toBe(200);
			}
			expect(await (await fetch(url + '/about/')).text()).toBe('<h1>about</h1>');
		});
	});

	test('answers unknown paths with a plain 404, not the home page', async () => {
		await serve({}, async url => {
			let res = await fetch(url + '/missing/');
			expect(res.status).toBe(404);
			expect(await res.text()).not.toContain('<h1>ok</h1>');
		});
	});

	test('answers unknown paths with the site 404 page', async () => {
		await serve({ '404/index.html': '<h1>lost</h1>' }, async url => {
			let res = await fetch(url + '/missing/');
			expect(res.status).toBe(404);
			expect(res.headers.get('content-type')).toStartWith('text/html');
			expect(await res.text()).toBe('<h1>lost</h1>');
		});
	});

	test('prefers a root 404.html page', async () => {
		await serve({ '404.html': '<h1>root</h1>', '404/index.html': '<h1>dir</h1>' }, async url => {
			let res = await fetch(url + '/missing.js');
			expect(res.status).toBe(404);
			expect(await res.text()).toBe('<h1>root</h1>');
		});
	});
});

describe('start', () => {
	for (let held of ['::1', '127.0.0.1']) {
		test(`skips a port that another server holds on ${held}, which localhost can reach`, async () => {
			let port = 6100 + Math.floor(Math.random() * 1500);
			let old = createServer((_, res) => res.end('old'));
			await new Promise<void>(resolve => old.listen(port, held, resolve));
			let opts = { ...argv(), host: 'localhost', port };
			let server = await http.start(opts);
			try {
				expect(opts.port).toBe(port + 1);
				expect(server.listenerCount('listening')).toBe(createServer().listenerCount('listening'));
				let res = await fetch(`http://localhost:${opts.port}/`);
				expect(await res.text()).toBe('<h1>ok</h1>');
			} finally {
				server.close();
				old.close();
			}
		});
	}

	test('survives a reload stream queued behind another response', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			await raw(opts.port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\nGET /~/reload HTTP/1.1\r\nHost: x\r\n\r\n');
			let res = await fetch(`http://127.0.0.1:${opts.port}/`);
			expect(res.status).toBe(200);
		} finally {
			server.close();
		}
	});

	test('survives request targets that are not valid urls', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			await raw(opts.port, 'GET // HTTP/1.1\r\nHost: x\r\n\r\n');
			await raw(opts.port, 'GET //x:99999999/a HTTP/1.1\r\nHost: x\r\n\r\n');
			let res = await fetch(`http://127.0.0.1:${opts.port}/`);
			expect(res.status).toBe(200);
		} finally {
			server.close();
		}
	});

	test('keeps sending after clients disconnect', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			let first = await socket(opts.port);
			first.close();
			await new Promise(r => setTimeout(r, 50));
			expect(() => http.send({ type: 'reload' })).not.toThrow();

			let late = await socket(opts.port);
			let got = next(late);
			http.send({ type: 'reload' });
			expect(await got).toEqual({ type: 'reload' });
			late.close();
		} finally {
			server.close();
		}
	});
});

describe('hold', () => {
	test('holds page requests until the task settles, then serves the finished output', async () => {
		let opts = argv();
		let release!: () => void;
		http.hold(new Promise<void>(r => release = r));
		let server = await http.start(opts);
		try {
			let settled = false;
			let pending = fetch(`http://127.0.0.1:${opts.port}/late/`).then(res => {
				settled = true;
				return res;
			});
			await new Promise(r => setTimeout(r, 150));
			expect(settled).toBe(false);

			mkdirSync(join(opts.dest, 'late'));
			writeFileSync(join(opts.dest, 'late/index.html'), '<h1>late</h1>');
			release();
			let res = await pending;
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('<h1>late</h1>');
		} finally {
			server.close();
			http.hold(Promise.resolve());
		}
	});

	test('never holds the reload stream', async () => {
		let opts = argv();
		http.hold(new Promise<void>(() => {}));
		let server = await http.start(opts);
		try {
			let ws = await socket(opts.port);
			ws.close();
		} finally {
			server.close();
			http.hold(Promise.resolve());
		}
	});

	test('releases held requests when the task fails', async () => {
		let opts = argv();
		let fail!: (err: Error) => void;
		http.hold(new Promise<void>((_, reject) => fail = reject));
		let server = await http.start(opts);
		try {
			let pending = fetch(`http://127.0.0.1:${opts.port}/`);
			fail(new Error('first build broke'));
			expect((await pending).status).toBe(200);
		} finally {
			server.close();
			http.hold(Promise.resolve());
		}
	});
});

describe('images', () => {
	test('serves the files the last dev flush listed, and passes other requests on', async () => {
		let opts = argv();
		let photo = join(opts.dest, 'my photo.png');
		copyFileSync(join(import.meta.dirname, '../../test/fixtures/site-image/content/blog/post/photo.png'), photo);
		let ctx = images.context({ outDir: opts.dest, cache: join(opts.dest, '.cache'), dev: true, emit: async file => file });
		let info = await images.prepare(photo, images.settings({ formats: 'webp' }, {}), ctx);

		let server = await http.start(opts);
		try {
			let url = (name: string) => `http://127.0.0.1:${opts.port}/docs/${encodeURIComponent(name)}`;
			let res = await fetch(url(info.filename));
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
			expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
			expect((await new Bun.Image(await res.arrayBuffer()).metadata()).width).toBe(800);

			let page = await fetch(`http://127.0.0.1:${opts.port}/`);
			expect(await page.text()).toBe('<h1>ok</h1>');

			writeFileSync(photo, 'changed');
			let broken = await fetch(url(info.variants[0].filename));
			expect(broken.status).toBe(500);
			expect(await broken.text()).toContain('changed after the build read it');
		} finally {
			server.close();
		}
	});
});
