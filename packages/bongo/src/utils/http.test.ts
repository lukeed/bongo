import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
