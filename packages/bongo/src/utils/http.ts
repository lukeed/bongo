import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, posix } from 'node:path';

import * as mime from 'mrmime';

import * as images from './images';
import * as log from './log';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Argv } from 'bongo';
import type { HmrMessage } from './bundler';
import type { Memory } from './output';

export const RELOAD = '/~/reload';

/** This server run. A page that another run rendered reloads when its socket connects. */
export const ID = randomBytes(6).toString('hex');

// Fixed by RFC 6455 to prove the server speaks WebSocket.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const clients = new Set<Duplex>();

let ready: Promise<void> = Promise.resolve();

/**
 * Hold page requests until `task` settles, whether it succeeds or fails; the reload stream is never held.
 * @example http.hold(firstBuild);
 */
export function hold(task: Promise<unknown>): void {
	ready = task.then(() => {}, () => {});
}

export function send(msg: HmrMessage): void {
	let data = frame(JSON.stringify(msg));
	for (let socket of clients) {
		if (socket.destroyed || !socket.writable) clients.delete(socket);
		else socket.write(data);
	}
}

// One unmasked text frame, as a server sends it.
function frame(text: string): Buffer {
	let body = Buffer.from(text);
	let n = body.length;
	let head = n < 126
		? [0x81, n]
		: n < 65536
			? [0x81, 126, n >>> 8, n & 255]
			: [0x81, 127, 0, 0, 0, 0, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
	return Buffer.concat([Buffer.from(head), body]);
}

// Reloads use a WebSocket because browsers allow six HTTP/1.1 connections per host, and a stream per open tab starves page loads.
function upgrade(req: IncomingMessage, socket: Duplex): void {
	let key = req.headers['sec-websocket-key'];
	let [path, query] = (req.url || '').split('?');
	if (path !== RELOAD || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') return void socket.destroy();

	let accept = createHash('sha1').update(key + GUID).digest('base64');
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	(socket as Socket).setTimeout?.(0);
	clients.add(socket);
	if (new URLSearchParams(query).get('id') !== ID) socket.write(frame(JSON.stringify({ type: 'reload' })));

	let drop = () => clients.delete(socket);
	socket.on('close', drop);
	socket.on('error', drop);
	socket.on('data', (chunk: Buffer) => {
		if ((chunk[0] & 0x0f) !== 0x8) return;
		drop();
		socket.end(Buffer.from([0x88, 2, 0x03, 0xe8]));
	});
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

const ETAGS: WeakMap<Buffer, string> = new WeakMap();

// sirv's lookup: the path as it is, then with .html or .htm, then as a folder with an index file
function candidates(path: string): string[] {
	if (path.endsWith('/')) return [path + 'index.html', path + 'index.htm'];
	return [path, path + '.html', path + '.htm', path + '/index.html', path + '/index.htm'];
}

// One `bytes=start-end` range of a body of `size` bytes; undefined when there is none, null when it cannot be served.
function range(header: string | undefined, size: number): [number, number] | null | undefined {
	let match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return header ? null : undefined;
	let [, from, to] = match;
	let start = from ? +from : Math.max(0, size - +to);
	let end = from && to ? Math.min(+to, size - 1) : size - 1;
	return from === '' && to === '' || start > end || start >= size ? null : [start, end];
}

async function deliver(req: IncomingMessage, res: ServerResponse, sink: Memory, file: string, status = 200): Promise<boolean> {
	let entry = sink.get(file);
	if (!entry) return false;
	if ('make' in entry) entry = { data: await entry.make(), version: 0 };
	let size: number, etag: string;
	if ('data' in entry) {
		size = entry.data.length;
		etag = ETAGS.get(entry.data) ?? `"${createHash('sha1').update(entry.data).digest('base64url')}"`;
		ETAGS.set(entry.data, etag);
	} else {
		let info = await stat(entry.file).catch(() => undefined);
		if (!info?.isFile()) return false;
		size = info.size;
		etag = `W/"${size}-${info.mtimeMs}"`;
	}

	let headers: Record<string, string | number> = {
		'content-type': mime.lookup(file) || 'application/octet-stream',
		'cache-control': 'no-cache',
		'accept-ranges': 'bytes',
		'etag': etag,
	};
	if (status === 200 && req.headers['if-none-match'] === etag) {
		res.writeHead(304, headers);
		return void res.end(), true;
	}

	let span = status === 200 ? range(req.headers.range, size) : undefined;
	if (span === null) {
		res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
		return void res.end(), true;
	}
	let [start, end] = span ?? [0, size - 1];
	if (span) {
		status = 206;
		headers['content-range'] = `bytes ${start}-${end}/${size}`;
	}
	headers['content-length'] = Math.max(0, end - start + 1);
	res.writeHead(status, headers);
	if (req.method === 'HEAD' || !size) return void res.end(), true;
	if ('data' in entry) return void res.end(entry.data.subarray(start, end + 1)), true;
	createReadStream(entry.file, { start, end }).pipe(res);
	return true;
}

/**
 * Serve the files of `sink` with live reload on the first port from `argv.port` that is free on every address `argv.host` can mean.
 * Sets `argv.port` to the port it took.
 * @example let server = await http.start(argv, sink);
 */
export async function start(argv: Required<Argv>, sink: Memory): Promise<Server> {
	clients.clear();

	const handler = async (req: IncomingMessage, res: ServerResponse) => {
		let path = (req.url || '/').replace(/[?#].*/, '');
		try { path = decodeURIComponent(path); } catch { /* keep as written */ }
		path = posix.normalize('/' + path);
		let base = sink.base;
		if (base !== '/' && (path === '/' || path === base.slice(0, -1))) {
			res.writeHead(302, { 'location': base, 'cache-control': 'no-store' });
			return void res.end();
		}
		if (path.startsWith(base)) {
			for (let candidate of candidates(path.slice(base.length - 1))) {
				if (await deliver(req, res, sink, join(argv.dest, candidate))) return;
			}
		}
		for (let page of ['404.html', '404/index.html']) {
			if (await deliver(req, res, sink, join(argv.dest, page), 404)) return;
		}
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
		res.end('Not Found');
	};

	const fail = (res: ServerResponse) => (err: unknown) => {
		let message = err instanceof Error ? err.message : String(err);
		log.error(message);
		if (res.headersSent) return void res.destroy();
		res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
		res.end(message);
	};

	const page = (req: IncomingMessage, res: ServerResponse) => {
		let pathname = (req.url || '/').replace(/[?#].*/, '');
		let name = pathname.slice(pathname.lastIndexOf('/') + 1);
		try { name = decodeURIComponent(name); } catch { /* keep as written */ }

		// resized images are encoded on their first request, then read from the cache
		let image = images.serve(name);
		if (!image) return void handler(req, res).catch(fail(res));
		return void image.then(body => {
			res.writeHead(200, {
				'content-type': mime.lookup(name) || 'application/octet-stream',
				'cache-control': 'public, max-age=31536000, immutable',
			});
			res.end(body);
		}, fail(res));
	};

	const respond = (req: IncomingMessage, res: ServerResponse) => {
		if ((req.url || '').split('?')[0] !== RELOAD) return void ready.then(() => page(req, res));
		res.writeHead(426, { 'upgrade': 'websocket', 'content-type': 'text/plain; charset=utf-8' });
		res.end('Upgrade Required');
	};

	let last = argv.port + 10;
	for (let port = argv.port; port <= last; port++) {
		let checks = await Promise.all(addresses(argv.host).map(address => free(port, address)));
		if (checks.includes(false)) continue;

		// a fresh server for each try, since a server that failed to listen may not listen again
		let server = createServer(respond);
		server.on('upgrade', upgrade);
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
