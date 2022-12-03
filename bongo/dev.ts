import { createReadStream, stat, Stats, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import * as http from 'node:http';

import flru from 'flru';
import * as mrmime from 'mrmime';
import { parse } from '@polka/url';

import * as build from './build';
import * as utils from './utils';
import * as $ from './paths';

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

const { PORT, HOST } = process.env;

export interface Argv {
	minify?: boolean;
	expose?: boolean;
}

const Extensions = ['', '.html', '.hbs', '.md'];
const Clients = new Set<ServerResponse>();

export function reload() {
	for (let res of Clients) {
		res.write('data: refresh\n\n');
	}
}

/**
 * find source "content/**" file from uri
 * @modified lukeed/sirv
 */
function locate(uri: string): string | void {
	let i=0, extn, arr: string[] = [];
	let tmp: string, len=uri.length-1;

	if (uri.charCodeAt(len) === 47) {
		uri = uri.substring(0, len);
	}

	tmp = uri + '/index';
	for (; i < Extensions.length; i++) {
		extn = Extensions[i];
		if (uri) arr.push(uri + extn);
		arr.push(tmp + extn);
	}

	for (i=0; i < arr.length; i++) {
		tmp = normalize( join($.CONTENT, arr[i]) );
		if (tmp.startsWith($.CONTENT)) {
			try { if (statSync(tmp).isFile()) return tmp }
			catch (_) { /* ignore; ENONET */ }
		}
	}
}

function send(res: ServerResponse, file: string, size: number, data?: string | Buffer) {
	let status = 200;

	let ctype = mrmime.lookup(file) || '';
	if (ctype === 'text/html') ctype += ';charset=utf-8';

	let opts: { start?: number, end?: number } = {};
	let headers: OutgoingHttpHeaders = {
		'Content-Length': size,
		'Content-Type': ctype,
	};

	// @see lukeed/sirv
	if (res.req.headers.range) {
		if (data != null) {
			data = Buffer.from(data);
			size = (data as Buffer).byteLength;
		}

		let [x, y] = res.req.headers.range.replace('bytes=', '').split('-');
		let end = opts.end = parseInt(y, 10) || size - 1;
		let start = opts.start = parseInt(x, 10) || 0;

		if (start >= size || end >= size) {
			res.setHeader('Content-Range', `bytes */${size}`);
			res.statusCode = 416;
			return res.end();
		}

		status = 206;
		headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
		headers['Content-Length'] = (end - start + 1);
		headers['Accept-Ranges'] = 'bytes';
	}

	res.writeHead(status, headers);
	if (data != null) return res.end(data);
	else createReadStream(file, opts).pipe(res);
}

// URL -> INPUT
const Cache = flru(100);

// INPUT -> ETAG
const Tags = new Map<string, string>();

export async function run(options: Argv) {
	//~> `build.*` fn config
	const config: build.Argv = {
		minify: !!options.minify,
		dev: true,
	};

	// initial build
	await build.setup();
	await utils.clean($.PUBLIC);
	console.log('---');

	let port = +PORT! || 8080;
	let host = HOST || 'localhost';
	if (!HOST && options.expose) host = '0.0.0.0';

	// TODO: render files as needed; NO PREBUILD
	let server = http.createServer(async function (req, res) {
		console.log('[>>>]', req.method, req.url);
		let { pathname } = parse(req);

		if (pathname !== '/~bongo~/reload') {
			let input = join($.PUBLIC, pathname);

			let stats: Stats | undefined;
			try { stats = statSync(input) }
			catch (_) { /* ENONET */ }

			if (stats && stats.isFile()) {
				res.setHeader('Cache-Control', 'no-store');
				return send(res, input, stats.size);
			}

			let etag = Tags.get(pathname) || `W/"dev-${Date.now()}"`;
			if (etag && req.headers['if-none-match'] === etag) {
				return res.writeHead(304), res.end();
			}

			input = Cache.get(pathname) || locate(pathname);

			if (input) {
				Tags.set(pathname, etag);
				Cache.set(pathname, input);

				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Etag', etag);

				let { file, data } = await build.compile(input, config);
				let clen = Buffer.byteLength(data);
				return send(res, file, clen, data);
			}

			console.error('[404]', req.method, req.url)
			res.statusCode = 404;
			return res.end();
		}

		res.writeHead(200, {
			'connection': 'keep-alive',
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
		});

		res.socket!.setTimeout(0);

		req.once('close', () => {
			Clients.delete(res);
			res.end();
		});

		res.write('event: status\ndata: open\n\n');

		return Clients.add(res);
	}).listen(port, host, () => {
		console.log('[dev] "http://%s:%d" ready!', host, port);
	});

	// rebuild "content/**" file on change
	utils.watch($.CONTENT, async (evt, rel) => {
		console.log('[dev] "content/%s" %sd', rel, evt);

		let file = join($.CONTENT, rel);

		// file to URL pathname
		let pathname = '/' + rel.replace(/[\\\/]+/g, '/').replace(/([/]?index)?\.(html?|hbs|md)$/g, '');
		Tags.delete(pathname);

		if (utils.exists(file)) {
			let out = await build.compile(file, config);
			await utils.write(out.file, out.data);
		}

		reload();
	});

	const isHBS = /\.hbs$/;

	// rebuild "layout/**" file on change
	utils.watch($.LAYOUTS, async (evt, rel) => {
		console.log('[dev] "layouts/%s" %sd', rel, evt);

		// reset all etags (safe)
		Tags.clear();

		// wipe "/layout" file
		build.Layouts.delete(rel);
		let file = join($.LAYOUTS, rel);
		if (isHBS.test(rel) && utils.exists(file)) {
			build.Layouts.set(rel, await utils.view(file));
		}

		reload();
	});

	// rebuild "partials/**" file on change
	utils.watch($.PARTIALS, async (evt, rel) => {
		console.log('[dev] "partials/%s" %sd', rel, evt);

		// reset all etags (safe)
		Tags.clear();

		let name = build.toPartialName(rel);
		build.Partials.delete(name);

		let file = join($.PARTIALS, rel);
		if (isHBS.test(rel) && utils.exists(file)) {
			utils.blocks[name] = await utils.view('' + file);
			build.Partials.set(name, utils.blocks[name]);
		}

		reload();
	});
}
