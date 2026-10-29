import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import worker from './worker';

import type { Mock } from 'bun:test';

type Sent = { url: string; init?: RequestInit };

let env = {
	CROWNE_SITE: 'site_123',
	CROWNE_KEY: 'crw_test_abc',
	ASSETS: { fetch: async (request: Request) => new Response(`asset ${request.method} ${new URL(request.url).pathname}`) },
};

let mock: Mock<typeof fetch> | undefined;

// Each upstream call, answered with `reply`.
function upstream(reply: () => Response): Sent[] {
	let sent: Sent[] = [];
	let { preconnect } = globalThis.fetch;
	mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
		sent.push({ url: String(input), init });
		return reply();
	}, { preconnect }));
	return sent;
}

function visit(path: string, init: RequestInit = {}, cf?: Record<string, string>): Request & { cf?: Record<string, string> } {
	return Object.assign(new Request('https://bongo.build' + path, init), { cf });
}

// crowne reads `CF-Connecting-IP` only on the Workers runtime.
let agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');

beforeAll(() => {
	Object.defineProperty(navigator, 'userAgent', { value: 'Cloudflare-Workers', configurable: true });
});

afterAll(() => {
	if (agent) Object.defineProperty(navigator, 'userAgent', agent);
	else Reflect.deleteProperty(navigator, 'userAgent');
});

afterEach(() => {
	mock?.mockRestore();
	mock = undefined;
});

describe('docs worker', () => {
	test('serves the crowne script as javascript, cached for an hour', async () => {
		let sent = upstream(() => new Response('(()=>{})()'));
		let res = await worker.fetch(visit('/x/script.js'), env);
		expect(sent.map(s => s.url)).toEqual(['https://in.crowne.io/v1/script.js']);
		expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(await res.text()).toBe('(()=>{})()');
	});

	test('sends events on as the browser sent them, with the key and the visitor, and no cookie', async () => {
		let sent = upstream(() => Response.json({ accepted: 1, rejected: 0, errors: [] }, { status: 202 }));
		let body = '[{"n":"pageview","u":"https://bongo.build/cli/","w":1200}]';
		let res = await worker.fetch(visit('/x', {
			method: 'POST',
			body,
			headers: {
				'cf-connecting-ip': '203.0.113.7',
				'user-agent': 'Safari/18',
				'accept-language': 'de-CH',
				'content-type': 'text/plain;charset=UTF-8',
				'crowne-visitor': 'ip=6.6.6.6',
				cookie: 'session=secret',
				origin: 'https://bongo.build',
			},
		}, { country: 'CH', region: 'Zürich', city: 'Zürich' }), env);

		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ accepted: 1, rejected: 0, errors: [] });
		let [{ url, init }] = sent;
		expect(url).toBe('https://in.crowne.io/v1/events?site=site_123');
		expect(init?.method).toBe('POST');
		expect(await new Response(init?.body).text()).toBe(body);
		expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
			authorization: 'Bearer crw_test_abc',
			'crowne-visitor': 'ip=203.0.113.7&country=CH&region=Z%C3%BCrich&city=Z%C3%BCrich',
			'user-agent': 'Safari/18',
			'accept-language': 'de-CH',
			'content-type': 'text/plain;charset=UTF-8',
		});
	});

	test('sends only the address when the request has no place', async () => {
		let sent = upstream(() => new Response(null, { status: 202 }));
		await worker.fetch(visit('/x', { method: 'POST', body: '{"n":"x"}', headers: { 'cf-connecting-ip': '203.0.113.7' } }), env);
		expect(new Headers(sent[0].init?.headers).get('crowne-visitor')).toBe('ip=203.0.113.7');
	});

	test('passes the status and the error of crowne back', async () => {
		upstream(() => Response.json({ error: 'key' }, { status: 401 }));
		let res = await worker.fetch(visit('/x', { method: 'POST', body: '{"n":"x"}', headers: { 'cf-connecting-ip': '203.0.113.7' } }), env);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'key' });
	});

	test('serves every other path and method from the assets', async () => {
		let sent = upstream(() => new Response(null, { status: 500 }));
		let text = async (path: string, init?: RequestInit) => (await worker.fetch(visit(path, init), env)).text();
		expect(await text('/cli/')).toBe('asset GET /cli/');
		expect(await text('/x')).toBe('asset GET /x');
		expect(await text('/x/script.js', { method: 'POST', body: 'x' })).toBe('asset POST /x/script.js');
		expect(sent).toEqual([]);
	});
});
