import sirv from 'sirv';
import { createServer } from 'http';
import type { Server, ServerResponse } from 'http';
import type { Argv } from 'bongo';

export const RELOAD = '/~/reload';

const clients = new Set<ServerResponse>();

export function reload() {
	for (let res of clients) {
		res.write('data: refresh\n\n');
	}
}

// TODO: port detect?
export function start(argv: Required<Argv>): Promise<Server> {
	clients.clear();

	const handler = sirv(argv.dest, {
		single: true,
		etag: true,
		dev: true,
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

		res.socket!.setTimeout(0);

		req.once('close', () => {
			clients.delete(res);
			res.end();
		});

		res.write('event: status\ndata: open\n\n');

		return clients.add(res);
	});

	return new Promise((res, rej) => {
		server.on('error', rej).listen(argv.port, argv.host, () => res(server));
	});
}
