/// <reference lib="dom" />

// The last path segment names a file of another type, such as `/llms.txt` or `/feed.xml`; an extension with no letter, as in `/v1.1.0`, is part of a page name.
const FILE = /\.(?!html?$)[a-z\d]*[a-z][a-z\d]*$/i;

/**
 * Whether `url` can be a page: its path ends in a folder, a name with no file extension, or `.html`.
 * @example page(new URL('https://example.com/llms.txt')) //=> false
 */
export function page(url: URL): boolean {
	return !FILE.test(url.pathname);
}

/** A fetched page: its HTML, and the URL that it came from after any redirect. */
export type Page = { html: string; url: URL };

/**
 * The page in `res`, fetched for `href`, or `undefined` when its content type is not HTML. A response with no content type counts as HTML.
 * A redirect gives the URL of its last response, with the hash of `href`, since a request carries no hash.
 * @example let page = await read(await fetch('/about'), '/about#team'); //=> { html, url: '/about/#team' }
 */
export async function read(res: Response, href: string): Promise<Page | undefined> {
	let type = res.headers.get('content-type');
	if (type && !/^text\/html\b/i.test(type)) return;
	let url = new URL(res.url || href, href);
	if (!url.hash) url.hash = new URL(href).hash;
	return { html: await res.text(), url };
}
