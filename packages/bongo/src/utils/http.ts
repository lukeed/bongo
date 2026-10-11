import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';

import * as mime from 'mrmime';
import sirv from 'sirv';

import * as images from './images';
import * as log from './log';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Argv } from 'bongo';
import type { HmrMessage } from './bundler';

export const RELOAD = '/~/reload';

const clients = new Set<ServerResponse>();

let ready: Promise<void> = Promise.resolve();

/**
 * Hold page requests until `task` settles, whether it succeeds or fails; the reload stream is never held.
 * @example http.hold(firstBuild);
 */
export function hold(task: Promise<unknown>): void {
	ready = task.then(() => {}, () => {});
}

export function send(msg: HmrMessage): void {
	let data = JSON.stringify(msg);
	for (let res of clients) {
		if (res.destroyed || res.writableEnded) clients.delete(res);
		else res.write(`data: ${data}\n\n`);
	}
}

// localhost and wildcard hosts are reachable on both loopbacks, so a server on either one holds the port.
function addresses(host: string): string[] {
	if (host === 'localhost') return ['127.0.0.1', '::1'];
	return ['0.0.0.0', '::', ''].includes(host) ? [host, '127.0.0.1', '::1'] : [host];
}

// Whether nothing listens on `port` at `address`; an address the machine lacks, like ::1 without IPv6, is free.
function free(port: number, address: string): Promise<boolean> {
	return new Promise(resolve => {
		let probe = createNetServer();
		probe.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'));
		probe.listen(port, address, () => probe.close(() => resolve(true)));
	});
}

function listen(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.off('error', reject);
			resolve();
		});
	});
}

/**
 * Serve `argv.dest` with live reload on the first port from `argv.port` that is free on every address `argv.host` can mean.
 * Sets `argv.port` to the port it took.
 * @example let server = await http.start(argv);
 */
export async function start(argv: Required<Argv>): Promise<Server> {
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

	const page = (req: IncomingMessage, res: ServerResponse) => {
		let pathname = (req.url || '/').replace(/[?#].*/, '');
		let name = pathname.slice(pathname.lastIndexOf('/') + 1);
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
	};

	const respond = (req: IncomingMessage, res: ServerResponse) => {
		if (req.url !== RELOAD) return void ready.then(() => page(req, res));

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

		clients.add(res);
	};

	let last = argv.port + 10;
	for (let port = argv.port; port <= last; port++) {
		let checks = await Promise.all(addresses(argv.host).map(address => free(port, address)));
		if (checks.includes(false)) continue;

		// a fresh server for each try, since a server that failed to listen may not listen again
		let server = createServer(respond);
		try {
			await listen(server, port, argv.host);
		} catch (err) {
			if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') continue;
			throw err;
		}
		argv.port = port;
		return server;
	}
	throw new Error(`Ports ${argv.port} to ${last} are all in use`);
}
