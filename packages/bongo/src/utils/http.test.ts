import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as http from './http';

import type { Argv } from 'bongo';

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

describe('send', () => {
	test('is a function (SSE sender present)', () => {
		expect(typeof http.send).toBe('function');
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

	test('keeps sending after clients disconnect', async () => {
		let opts = argv();
		let server = await http.start(opts);
		try {
			let first = await raw(opts.port, 'GET /~/reload HTTP/1.1\r\nHost: x\r\n\r\n', 50);
			expect(first).toContain('event: status');
			expect(() => http.send({ type: 'reload' })).not.toThrow();

			let late = raw(opts.port, 'GET /~/reload HTTP/1.1\r\nHost: x\r\n\r\n', 200);
			await new Promise(r => setTimeout(r, 80));
			http.send({ type: 'reload' });
			expect(await late).toContain('"type":"reload"');
		} finally {
			server.close();
		}
	});
});
