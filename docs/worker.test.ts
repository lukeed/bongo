import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import type { Mock } from 'bun:test';

import worker from './worker';

type Sent = { url: string; init?: RequestInit };

let env = {
	CROWNE_SITE: 'site_123',
	CROWNE_KEY: 'crw_test_abc',
	ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) },
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
	let request = new Request('https://bongo.build' + path, init);
	return Object.assign(request, { cf });
}

afterEach(() => {
	mock?.mockRestore();
	mock = undefined;
});

describe('docs worker', () => {
	test('serves the crowne script as crowne sends it', async () => {
		let sent = upstream(() => new Response('(()=>{})()', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' } }));
		let res = await worker.fetch(visit('/js/script.js'), env);
		expect(sent.map(s => s.url)).toEqual(['https://in.crowne.io/v1/script.js']);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(await res.text()).toBe('(()=>{})()');
	});

	test('forwards events with the key, the site, and the visitor from the request', async () => {
		let sent = upstream(() => Response.json({ accepted: 1, rejected: 0, errors: [] }, { status: 202 }));
		let res = await worker.fetch(visit('/api/event', {
			method: 'POST',
			body: JSON.stringify({ n: 'pageview', u: 'https://bongo.build/cli/', w: 1200, ip: '1.1.1.1' }),
			headers: { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Safari/18', 'accept-language': 'de-DE' },
		}, { country: 'DE', region: 'Berlin', city: 'Berlin' }), env);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ accepted: 1, rejected: 0, errors: [] });
		expect(sent).toHaveLength(1);
		let [{ url, init }] = sent;
		expect(url).toBe('https://in.crowne.io/v1/events?site=site_123');
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer crw_test_abc');
		expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(String(init?.body))).toEqual([{
			n: 'pageview', u: 'https://bongo.build/cli/', w: 1200,
			ip: '203.0.113.7', ua: 'Safari/18', language: 'de-DE', country: 'DE', region: 'Berlin', city: 'Berlin',
		}]);
	});

	test('passes a batch through, and leaves out what the request does not have', async () => {
		let sent = upstream(() => Response.json({ accepted: 2, rejected: 0, errors: [] }, { status: 202 }));
		await worker.fetch(visit('/api/event', {
			method: 'POST',
			body: JSON.stringify([{ n: 'a' }, { n: 'b', p: { x: 1 } }]),
			headers: { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Safari/18' },
		}), env);
		expect(JSON.parse(String(sent[0].init?.body))).toEqual([
			{ n: 'a', ip: '203.0.113.7', ua: 'Safari/18' },
			{ n: 'b', p: { x: 1 }, ip: '203.0.113.7', ua: 'Safari/18' },
		]);
	});

	test('passes the status and the error of crowne back', async () => {
		upstream(() => Response.json({ error: 'key' }, { status: 401 }));
		let res = await worker.fetch(visit('/api/event', { method: 'POST', body: '{"n":"x"}' }), env);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'key' });
	});

	test('refuses what crowne would refuse, without a call to it', async () => {
		let sent = upstream(() => new Response(null, { status: 500 }));
		let post = (body: string) => worker.fetch(visit('/api/event', { method: 'POST', body }), env);
		expect((await post('{nope')).status).toBe(400);
		expect((await post('[]')).status).toBe(400);
		expect((await post(JSON.stringify(Array.from({ length: 51 }, () => ({ n: 'x' }))))).status).toBe(400);
		expect((await post('[1]')).status).toBe(400);
		expect((await post(JSON.stringify({ n: 'x'.repeat(256 * 1024) }))).status).toBe(413);
		expect((await worker.fetch(visit('/api/event'), env)).status).toBe(405);
		expect((await worker.fetch(visit('/js/script.js', { method: 'POST', body: 'x' }), env)).status).toBe(405);
		expect(sent).toEqual([]);
	});

	test('fails events, and says why, when the site or the key is not set', async () => {
		let sent = upstream(() => new Response(null, { status: 202 }));
		let error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			let res = await worker.fetch(visit('/api/event', { method: 'POST', body: '{"n":"x"}' }), { ...env, CROWNE_KEY: '' });
			expect(res.status).toBe(500);
			expect(error.mock.calls[0][0]).toContain('CROWNE_KEY');
			expect(sent).toEqual([]);
		} finally {
			error.mockRestore();
		}
	});

	test('serves every other path from the assets', async () => {
		let res = await worker.fetch(visit('/cli/'), env);
		expect(await res.text()).toBe('asset /cli/');
	});
});
