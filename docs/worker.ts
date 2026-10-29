import { crowne } from "crowne/server";

type Env = {
	CROWNE_SITE: string;
	CROWNE_KEY: string;
	ASSETS: {
		fetch(request: Request): Promise<Response>;
	};
};

/**
 * @see https://crowne.io/docs/proxy/#cloudflare-workers
 */
export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		let { pathname } = new URL(req.url);

		let isEvent = req.method === "POST" && pathname === "/x";
		let isScript = req.method === "GET" && pathname === "/x/script.js";
		if (isScript || isEvent) {
			return crowne({ key: env.CROWNE_KEY, site: env.CROWNE_SITE }).proxy(req);
		}

		return env.ASSETS.fetch(req);
	},
};
