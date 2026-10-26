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

/**
 * The text of `res`, or `undefined` when its content type is not HTML. A response with no content type counts as HTML.
 * @example let text = await read(await fetch('/about/'));
 */
export async function read(res: Response): Promise<string | undefined> {
	let type = res.headers.get('content-type');
	if (type && !/^text\/html\b/i.test(type)) return;
	return res.text();
}
