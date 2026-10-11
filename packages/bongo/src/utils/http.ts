import { createServer } from 'node:http';
import { basename } from 'node:path';
import * as mime from 'mrmime';
import sirv from 'sirv';
import * as images from './images';
import * as log from './log';

import type { Server, ServerResponse } from 'node:http';
import type { Argv } from 'bongo';
import type { HmrMessage } from './bundler';

export const RELOAD = '/~/reload';

const clients = new Set<ServerResponse>();

export function send(msg: HmrMessage): void {
	let data = JSON.stringify(msg);
	for (let res of clients) {
		if (res.destroyed || res.writableEnded) clients.delete(res);
		else res.write(`data: ${data}\n\n`);
	}
}

export function start(argv: Required<Argv>): Promise<Server> {
	clients.clear();

	const handler = sirv(argv.dest, {
		single: true,
		etag: true,
		dev: true,
	});

	const server = createServer((req, res) => {
		if (req.url !== RELOAD) {
			let { pathname } = new URL(req.url || '/', 'http://bongo');
			let name = basename(pathname);
			try { name = decodeURIComponent(name); } catch { /* keep as written */ }

			// resized images are encoded on their first request, then read from the cache
			let image = images.serve(name);
			if (!image) return handler(req, res);
			return void image.then(body => {
				res.writeHead(200, {
					'content-type': mime.lookup(name) || 'application/octet-stream',
					'cache-control': 'public, max-age=31536000, immutable',
				});
				res.end(body);
			}, err => {
				let message = err instanceof Error ? err.message : String(err);
				log.error(message);
				res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
				res.end(message);
			});
		}

		res.writeHead(200, {
			'connection': 'keep-alive',
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
		});

		// a pipelined response has no socket until earlier ones finish; the connection is on `req`
		req.socket.setTimeout(0);

		req.once('close', () => {
			clients.delete(res);
			res.end();
		});
		res.on('error', () => clients.delete(res));

		res.write('event: status\ndata: open\n\n');

		return clients.add(res);
	});

	return new Promise((resolve, reject) => {
		function tryListen(port: number, remaining: number): void {
			server.once('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE' && remaining > 0) {
					tryListen(port + 1, remaining - 1);
				} else {
					reject(err);
				}
			});
			server.listen(port, argv.host, () => {
				argv.port = port;
				resolve(server);
			});
		}
		tryListen(argv.port, 10);
	});
}
