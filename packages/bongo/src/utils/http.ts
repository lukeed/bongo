import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import sirv from 'sirv';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
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
		etag: true,
		dev: true,
		async onNoMatch(_req: IncomingMessage, res: ServerResponse) {
			let page = await readFile(join(argv.dest, '404.html'))
				.catch(() => readFile(join(argv.dest, '404/index.html')))
				.catch(() => undefined);
			res.writeHead(404, {
				'content-type': `text/${page ? 'html' : 'plain'}; charset=utf-8`,
				'cache-control': 'no-store',
			});
			res.end(page ?? 'Not Found');
		},
	});

	const server = createServer((req, res) => {
		if (req.url !== RELOAD) {
			return handler(req, res);
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
