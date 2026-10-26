// The paths of crowne.io analytics on this site; wrangler.jsonc runs the Worker first for these alone.
const SCRIPT = '/js/script.js';
const EVENTS = '/api/event';

// crowne takes one event, or up to 50, in at most 256 KB.
const BATCH = 50;
const SIZE = 256 * 1024;

type Env = {
	ASSETS: { fetch(request: Request): Promise<Response> };
	CROWNE_SITE: string;
	CROWNE_KEY: string;
};

type Visit = Request & {
	cf?: { country?: string; region?: string; city?: string };
};

type Event = Record<string, unknown>;

function refuse(status: number, error: string): Response {
	return Response.json({ error }, { status });
}

/**
 * The events of a page, with the visitor that crowne needs from a server: their address, browser, language, and location.
 * @example await events(request, env)
 */
async function events(request: Visit, env: Env): Promise<Response> {
	if (!env.CROWNE_SITE || !env.CROWNE_KEY) {
		console.error('crowne: set the CROWNE_SITE var and the CROWNE_KEY secret of the docs Worker');
		return refuse(500, 'setup');
	}

	let text = await request.text();
	if (new TextEncoder().encode(text).length > SIZE) return refuse(413, 'size');
	try {
		var body: unknown = JSON.parse(text);
	} catch {
		return refuse(400, 'json');
	}

	let list = Array.isArray(body) ? body : [body];
	if (list.length < 1 || list.length > BATCH) return refuse(400, 'batch');
	if (!list.every((item): item is Event => typeof item === 'object' && item !== null && !Array.isArray(item))) return refuse(400, 'invalid');

	let { headers, cf } = request;
	let visitor = Object.fromEntries(Object.entries({
		ip: headers.get('cf-connecting-ip'),
		ua: headers.get('user-agent'),
		language: headers.get('accept-language'),
		country: cf?.country,
		region: cf?.region,
		city: cf?.city,
	}).filter(([, value]) => value));

	let reply = await fetch(`https://in.crowne.io/v1/events?site=${encodeURIComponent(env.CROWNE_SITE)}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${env.CROWNE_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify(list.map(item => ({ ...item, ...visitor }))),
	});
	return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.headers.get('content-type') ?? 'application/json' } });
}

/**
 * The docs Worker: it proxies crowne.io analytics on paths of this site, and serves every other path from the assets.
 * @example export default worker
 */
export default {
	async fetch(request: Visit, env: Env): Promise<Response> {
		let { pathname } = new URL(request.url);
		if (pathname === SCRIPT) {
			if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
			return fetch('https://in.crowne.io/v1/script.js');
		}
		if (pathname === EVENTS) {
			if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
			return events(request, env);
		}
		return env.ASSETS.fetch(request);
	},
};
