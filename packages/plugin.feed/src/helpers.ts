export type Format = 'rss' | 'atom';

export type Attrs = Record<string, string | true>;

export const MIME: Record<Format, string> = {
	atom: 'application/atom+xml',
	rss: 'application/rss+xml',
};

const XML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * Escape text for XML element content or a quoted attribute.
 * @example xml('Tom & "Jerry"') //=> 'Tom &amp; &quot;Jerry&quot;'
 */
export function xml(value: unknown): string {
	return String(value ?? '').replace(/[&<>"']/g, c => XML[c]);
}

/**
 * Epoch milliseconds of a Date, a number, or a date string; undefined when it is not a valid date.
 * @example time('2025-01-01T00:00:00Z') //=> 1735689600000
 */
export function time(value: unknown): number | undefined {
	let stamp = value instanceof Date ? value.getTime()
		: typeof value === 'number' ? value
		: typeof value === 'string' && value ? new Date(value).getTime()
		: NaN;
	return Number.isFinite(stamp) ? stamp : undefined;
}

/**
 * An ISO 8601 date, for Atom.
 * @example iso('2025-06-15T12:00:00Z') //=> '2025-06-15T12:00:00.000Z'
 */
export function iso(value: unknown): string | undefined {
	let stamp = time(value);
	return stamp === undefined ? undefined : new Date(stamp).toISOString();
}

/**
 * An RFC 822 date, for RSS.
 * @example utc('2025-06-15T12:00:00Z') //=> 'Sun, 15 Jun 2025 12:00:00 GMT'
 */
export function utc(value: unknown): string | undefined {
	let stamp = time(value);
	return stamp === undefined ? undefined : new Date(stamp).toUTCString();
}

/**
 * The latest valid date among `values`, as epoch milliseconds.
 * @example latest(['2024-01-01', 'garbage', '2025-06-15']) //=> 1749945600000
 */
export function latest(values: unknown[]): number | undefined {
	let winner: number | undefined;
	for (let value of values) {
		let stamp = time(value);
		if (stamp !== undefined && (winner === undefined || stamp > winner)) winner = stamp;
	}
	return winner;
}

const ATTR = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|#[xX][\da-fA-F]+);/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode the XML entities and numeric character references in `input`, once.
 * @example decode('Tom &amp;amp; Jerry &#65;') //=> 'Tom &amp; Jerry A'
 */
export function decode(input: string): string {
	return input.replace(ENTITY, (match, name: string) => {
		if (ENTITIES[name]) return ENTITIES[name];
		let hex = name[1] === 'x' || name[1] === 'X';
		let code = parseInt(name.substring(hex ? 2 : 1), hex ? 16 : 10);
		return code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

/**
 * Read element attributes as text, as HTML does: each value is decoded once, and a name with no value is `true`.
 * @example attrs('href="/a?x=1&amp;y=2" draft') //=> { href: '/a?x=1&y=2', draft: true }
 */
export function attrs(input: string): Attrs {
	let out: Attrs = {};
	for (let match of input.matchAll(ATTR)) {
		let value = match[2] ?? match[3] ?? match[4];
		out[match[1]] = value === undefined ? true : decode(value);
	}
	return out;
}

/**
 * Text of an attribute, or '' when it is missing or has no value.
 * @example text(attrs('a="x" b').b) //=> ''
 */
export function text(value: string | true | undefined): string {
	return typeof value === 'string' ? value : '';
}

/**
 * An absolute URL for `href`. A path resolves under `$site.url`, so a site in a subfolder keeps it.
 * @example url('/blog/a/', 'https://example.com/sub/') //=> 'https://example.com/sub/blog/a/'
 */
export function url(href: string, site: string): string {
	if (/^https?:\/\//i.test(href) || !site) return href;
	let base = site.endsWith('/') ? site : site + '/';
	return new URL(href.replace(/^\/+/, ''), base).href;
}
