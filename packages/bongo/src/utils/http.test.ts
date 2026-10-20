import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import * as http from './http';
import * as images from './images';
import * as output from './output';

import type { Argv } from 'bongo';
import type { HmrMessage } from './bundler';

function argv(): Required<Argv> & { sink: output.Memory } {
	let dest = mkdtempSync(join(tmpdir(), 'bongo-http-'));
	let sink = output.memory(dest);
	sink.write(join(dest, 'index.html'), '<h1>ok</h1>');
	return { dest, host: '127.0.0.1', port: 4900 + Math.floor(Math.random() * 900), sink } as Required<Argv> & { sink: output.Memory };
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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
		for (let [rel, text] of Object.entries(files)) await opts.sink.write(join(opts.dest, rel), text);
		let server = await http.start(opts, opts.sink);
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

describe('subpath', () => {
	test('serves a site whose $site.url has a subpath under that subpath, as a host does', async () => {
		let opts = argv();
		opts.sink.base = '/blog/';
		await opts.sink.write(join(opts.dest, 'style.css'), 'b{}');
		await opts.sink.write(join(opts.dest, 'post/index.html'), '<h1>post</h1>');
		await opts.sink.write(join(opts.dest, '404.html'), '<h1>lost</h1>');
		let server = await http.start(opts, opts.sink);
		let url = `http://127.0.0.1:${opts.port}`;
		try {
			expect(await (await fetch(url + '/blog/')).text()).toBe('<h1>ok</h1>');
			expect(await (await fetch(url + '/blog/post/')).text()).toBe('<h1>post</h1>');
			expect(await (await fetch(url + '/blog/style.css')).text()).toBe('b{}');
			for (let path of ['/', '/blog']) {
				let res = await fetch(url + path, { redirect: 'manual' });
				expect(res.status).toBe(302);
				expect(res.headers.get('location')).toBe('/blog/');
			}
			let outside = await fetch(url + '/style.css');
			expect(outside.status).toBe(404);
			expect(await outside.text()).toBe('<h1>lost</h1>');
		} finally {
			server.close();
		}
	});
});

describe('memory', () => {
	test('serves text in UTF-8, and other files as they are', async () => {
		let opts = argv();
		let server = await http.start(opts, opts.sink);
		let url = `http://127.0.0.1:${opts.port}`;
		try {
			let files: [string, string, string][] = [
				['notes.md', '# Notes — ü', 'text/markdown; charset=utf-8'],
				['feed.xml', '<feed/>', 'text/xml; charset=utf-8'],
				['data.json', '{}', 'application/json; charset=utf-8'],
				['app.js', '1', 'text/javascript; charset=utf-8'],
				['icon.svg', '<svg/>', 'image/svg+xml; charset=utf-8'],
				['font.woff2', 'x', 'font/woff2'],
				['blob.bin', 'x', 'application/octet-stream'],
			];
			for (let [name, body, type] of files) {
				await opts.sink.write(join(opts.dest, name), body);
				let res = await fetch(`${url}/${name}`);
				expect(res.headers.get('content-type')).toBe(type);
				expect(await res.text()).toBe(body);
			}
		} finally {
			server.close();
		}
	});

	test('serves files from the sink with their content type, an etag, HEAD, and ranges', async () => {
		let opts = argv();
		let server = await http.start(opts, opts.sink);
		let url = `http://127.0.0.1:${opts.port}`;
		try {
			await opts.sink.write(join(opts.dest, 'app.css'), 'body{}');
			let res = await fetch(url + '/app.css');
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
			expect(res.headers.get('content-length')).toBe('6');
			expect(res.headers.get('cache-control')).toBe('no-cache');
			expect(await res.text()).toBe('body{}');

			let etag = res.headers.get('etag') ?? '';
			expect(etag).not.toBe('');
			expect((await fetch(url + '/app.css', { headers: { 'if-none-match': etag } })).status).toBe(304);
			await opts.sink.write(join(opts.dest, 'app.css'), 'main{}');
			let changed = await fetch(url + '/app.css', { headers: { 'if-none-match': etag } });
			expect(changed.status).toBe(200);
			expect(await changed.text()).toBe('main{}');

			let head = await fetch(url + '/app.css', { method: 'HEAD' });
			expect(head.status).toBe(200);
			expect(head.headers.get('content-length')).toBe('6');
			expect(await head.text()).toBe('');

			let part = await fetch(url + '/app.css', { headers: { range: 'bytes=1-3' } });
			expect(part.status).toBe(206);
			expect(part.headers.get('content-range')).toBe('bytes 1-3/6');
			expect(await part.text()).toBe('ain');
		} finally {
			server.close();
		}
	});

	test('serves a copied file from its source, so an edit shows at once', async () => {
		let opts = argv();
		let source = join(opts.dest, '..', `bongo-http-src-${Date.now()}.txt`);
		writeFileSync(source, 'one');
		await opts.sink.copy(source, join(opts.dest, 'notes/a.txt'));
		let server = await http.start(opts, opts.sink);
		try {
			let url = `http://127.0.0.1:${opts.port}/notes/a.txt`;
			expect(await (await fetch(url)).text()).toBe('one');
			writeFileSync(source, 'two!');
			let res = await fetch(url);
			expect(res.headers.get('content-length')).toBe('4');
			expect(await res.text()).toBe('two!');
		} finally {
			server.close();
		}
	});

	test('a file that is gone from the sink is a 404', async () => {
		let opts = argv();
		let server = await http.start(opts, opts.sink);
		try {
			await opts.sink.write(join(opts.dest, 'gone/index.html'), 'x');
			expect((await fetch(`http://127.0.0.1:${opts.port}/gone/`)).status).toBe(200);
			await opts.sink.remove(join(opts.dest, 'gone/index.html'));
			expect((await fetch(`http://127.0.0.1:${opts.port}/gone/`)).status).toBe(404);
		} finally {
			server.close();
		}
	});
});

describe('start', () => {
	for (let held of ['::1', '127.0.0.1']) {
		test(`skips a port that another server holds on ${held}, which localhost can reach`, async () => {
			let port = 6100 + Math.floor(Math.random() * 1500);
			let old = createServer((_, res) => res.end('old'));
			await new Promise<void>(resolve => old.listen(port, held, resolve));
			let opts = { ...argv(), host: 'localhost', port };
			let server = await http.start(opts, opts.sink);
			try {
				expect(opts.port).toBe(port + 1);
				expect(server.listenerCount('listening')).toBe(createServer().listenerCount('listening'));
				// the address that localhost resolved to, since an old fetch() may try only the other one
				let info = server.address();
				if (!info || typeof info === 'string') throw new Error('no address');
				let res = await fetch(`http://${info.family === 'IPv6' ? `[${info.address}]` : info.address}:${opts.port}/`);
				expect(await res.text()).toBe('<h1>ok</h1>');
			} finally {
				server.close();
				old.close();
			}
		});
	}

	test('survives a reload stream queued behind another response', async () => {
		let opts = argv();
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
		try {
			let settled = false;
			let pending = fetch(`http://127.0.0.1:${opts.port}/late/`).then(res => {
				settled = true;
				return res;
			});
			await new Promise(r => setTimeout(r, 150));
			expect(settled).toBe(false);

			await opts.sink.write(join(opts.dest, 'late/index.html'), '<h1>late</h1>');
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
		let server = await http.start(opts, opts.sink);
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
		let server = await http.start(opts, opts.sink);
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

		let server = await http.start(opts, opts.sink);
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
