type Env = {
	CROWNE_SITE: string;
	CROWNE_KEY: string;
	ASSETS: {
		fetch(request: Request): Promise<Response>;
	};
};

type Visit = Request & {
	cf?: { country?: string; region?: string; city?: string };
};

/**
 * The docs Worker: it proxies crowne.io analytics on `/x/script.js` and `/x`, which wrangler.jsonc runs it first for, and serves every other path from the assets.
 * @see https://crowne.io/docs/api/#from-your-own-proxy
 */
export default {
	async fetch(req: Visit, env: Env): Promise<Response> {
		let { pathname } = new URL(req.url);
		if (req.method === "GET" && pathname === "/x/script.js") {
			return fetch("https://in.crowne.io/v1/script.js");
		}

		if (req.method !== "POST" || pathname !== "/x") {
			return env.ASSETS.fetch(req);
		}

		let visitor = new URLSearchParams({
			ip: req.headers.get("cf-connecting-ip") ?? "",
		});

		let { country, region, city } = req.cf ?? {};
		for (let [field, value] of Object.entries({ country, region, city })) {
			if (value) visitor.set(field, value);
		}

		let headers = new Headers({
			"authorization": `Bearer ${env.CROWNE_KEY}`,
			"crowne-visitor": String(visitor),
		});

		for (let name of ["user-agent", "accept-language", "content-type"]) {
			let value = req.headers.get(name);
			if (value) headers.set(name, value);
		}

		return fetch(`https://in.crowne.io/v1/events?site=${env.CROWNE_SITE}`, {
			method: "POST",
			headers,
			body: req.body,
		});
	},
};
