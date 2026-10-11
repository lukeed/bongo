type Line = { num: number; indent: number; text: string };
type Pair = { key: string; rest: string };

export type Hit = { value: unknown; end: number };

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*(?:\s+#.*)?$/;
const TRAILING = /^\s*(?:#.*)?$/;

const ESCAPES: Record<string, string> = {
	'0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
	N: '\x85', _: '\xa0', L: ' ', P: ' ',
};

const HEX: Record<string, number> = { x: 2, u: 4, U: 8 };

function fail(num: number, reason: string): SyntaxError {
	return new SyntaxError(`${reason} at line ${num}`);
}

function set(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function ws(src: string, pos: number): number {
	while (pos < src.length && /\s/.test(src[pos])) pos++;
	return pos;
}

function isQuote(c: string | undefined, js: boolean): boolean {
	return c === '"' || c === "'" || (js && c === '`');
}

function isItem(text: string): boolean {
	return text === '-' || text.startsWith('- ');
}

/**
 * Resolve an unquoted word: `null`, `~`, and empty text are null, `true` and `false` are booleans,
 * decimal numbers without a leading zero are numbers, and anything else is the text itself.
 * @example scalar('42') //=> 42
 * @example scalar('1.0.0') //=> '1.0.0'
 */
export function scalar(text: string): unknown {
	if (text === '' || text === '~' || /^(?:null|Null|NULL)$/.test(text)) return null;
	if (/^(?:true|True|TRUE)$/.test(text)) return true;
	if (/^(?:false|False|FALSE)$/.test(text)) return false;
	if (NUMBER.test(text)) {
		let num = Number(text);
		if (Number.isFinite(num)) return num;
	}
	return text;
}

function quote(src: string, pos: number, js: boolean): Hit | undefined {
	let mark = src[pos];
	let out = '';

	for (let i = pos + 1; i < src.length; i++) {
		let c = src[i];

		if (c === mark) {
			if (mark === "'" && !js && src[i + 1] === "'") {
				out += "'";
				i++;
				continue;
			}
			return { value: out, end: i + 1 };
		}

		if (c !== '\\' || (!js && mark === "'")) {
			out += c;
			continue;
		}

		let esc = src[++i];
		if (esc === undefined) return;

		let size = HEX[esc];
		if (!size) {
			out += ESCAPES[esc] ?? esc;
			continue;
		}

		let hex = src.slice(i + 1, i + 1 + size);
		let code = parseInt(hex, 16);
		if (hex.length !== size || !/^[\da-f]+$/i.test(hex) || code > 0x10ffff) return;
		out += String.fromCodePoint(code);
		i += size;
	}
}

function list(src: string, pos: number, js: boolean): Hit | undefined {
	let out: unknown[] = [];
	pos = ws(src, pos + 1);

	while (src[pos] !== ']') {
		if (pos >= src.length) return;
		let hit = read(src, pos, js);
		if (!hit) return;
		out.push(hit.value);
		pos = ws(src, hit.end);
		if (src[pos] === ',') pos = ws(src, pos + 1);
		else if (src[pos] !== ']') return;
	}

	return { value: out, end: pos + 1 };
}

function map(src: string, pos: number, js: boolean): Hit | undefined {
	let out: Record<string, unknown> = {};
	pos = ws(src, pos + 1);

	while (src[pos] !== '}') {
		if (pos >= src.length) return;

		let key: string;
		if (isQuote(src[pos], js)) {
			let hit = quote(src, pos, js);
			if (!hit) return;
			key = String(hit.value);
			pos = ws(src, hit.end);
		} else {
			let end = pos;
			while (end < src.length && !':,}'.includes(src[end])) end++;
			key = src.slice(pos, end).trim();
			pos = end;
			if (!key) return;
		}

		let value: unknown = null;
		if (src[pos] === ':') {
			pos = ws(src, pos + 1);
			if (src[pos] !== ',' && src[pos] !== '}') {
				let hit = read(src, pos, js);
				if (!hit) return;
				value = hit.value;
				pos = ws(src, hit.end);
			}
		}

		set(out, key, value);
		if (src[pos] === ',') pos = ws(src, pos + 1);
		else if (src[pos] !== '}') return;
	}

	return { value: out, end: pos + 1 };
}

/**
 * Read one inline value at `pos`: a quoted string, a `[…]` list, a `{…}` map, or a plain word
 * that ends at `,`, `]`, or `}`. Returns undefined when the value is unterminated or malformed.
 * With `js`, every quote style (including backticks) takes backslash escapes, as in JavaScript,
 * and nothing is ever evaluated.
 * @example read('[a, 1] rest', 0, false) //=> { value: ['a', 1], end: 6 }
 */
export function read(src: string, pos: number, js: boolean): Hit | undefined {
	let c = src[pos];
	if (isQuote(c, js)) return quote(src, pos, js);
	if (c === '[') return list(src, pos, js);
	if (c === '{') return map(src, pos, js);

	let end = pos;
	while (end < src.length && !',]}'.includes(src[end])) end++;
	return { value: scalar(src.slice(pos, end).trim()), end };
}

function uncomment(rest: string): string {
	rest = rest.trim();
	return rest[0] === '#' ? '' : rest;
}

function pair(text: string): Pair | undefined {
	if (isQuote(text[0], false)) {
		let hit = quote(text, 0, false);
		let colon = hit && /^\s*:(?:\s+|$)/.exec(text.slice(hit.end));
		if (!hit || !colon) return;
		return { key: String(hit.value), rest: uncomment(text.slice(hit.end + colon[0].length)) };
	}

	if ('[{#'.includes(text[0]) || isItem(text)) return;
	let at = text.search(/:(?:\s|$)/);
	if (at < 1) return;
	return { key: text.slice(0, at).trimEnd(), rest: uncomment(text.slice(at + 1)) };
}

function inline(raw: string, num: number): unknown {
	if (BLOCK_SCALAR.test(raw)) throw fail(num, 'block scalars (| and >) are not supported');
	if ('"\'[{'.includes(raw[0])) {
		let hit = read(raw, 0, false);
		if (hit && TRAILING.test(raw.slice(hit.end))) return hit.value;
	}
	return scalar(raw.replace(/\s+#.*$/, ''));
}

/**
 * Parse bongo's YAML subset: `key: value` maps nested by indentation, block (`- item`) and
 * inline (`[a, b]`) lists, inline maps (`{a: 1}`), plain, single-quoted, and double-quoted
 * strings, numbers, booleans, null, and `#` comments. Dates stay strings. A value that is not
 * one whole quoted string, list, or map is read as plain text.
 * Throws a SyntaxError that names the line, counted from `first`.
 * @example parse('title: Hello\ntags: [a, b]\ndraft: true') //=> { title: 'Hello', tags: ['a', 'b'], draft: true }
 */
export function parse(input: string, first = 1): unknown {
	let lines: Line[] = [];

	input.split(/\r?\n/).forEach((raw, idx) => {
		let text = raw.trim();
		if (!text || text[0] === '#' || (text === '---' && !lines.length)) return;
		let indent = raw.search(/\S/);
		if (raw.slice(0, indent).includes('\t')) throw fail(first + idx, 'tabs are not allowed in indentation');
		lines.push({ num: first + idx, indent, text });
	});

	let i = 0;

	function child(indent: number): unknown {
		let next = lines[i];
		return next && next.indent > indent ? node(next.indent) : null;
	}

	function items(indent: number): unknown[] {
		let out: unknown[] = [];
		while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
			let line = lines[i];
			let rest = uncomment(line.text.slice(1));
			if (!rest) {
				i++;
				out.push(child(indent));
				continue;
			}
			let col = indent + line.text.length - rest.length;
			lines[i] = { num: line.num, indent: col, text: rest };
			out.push(node(col));
		}
		return out;
	}

	function entries(indent: number): Record<string, unknown> {
		let out: Record<string, unknown> = {};
		while (i < lines.length && lines[i].indent === indent) {
			let line = lines[i];
			let kv = pair(line.text);
			if (!kv) throw fail(line.num, 'expected "key: value"');
			if (Object.hasOwn(out, kv.key)) throw fail(line.num, `duplicate key "${kv.key}"`);
			i++;

			let next = lines[i];
			if (kv.rest) {
				set(out, kv.key, inline(kv.rest, line.num));
				if (next && next.indent > indent) throw fail(next.num, 'bad indentation');
			} else if (next && next.indent === indent && isItem(next.text)) {
				set(out, kv.key, items(indent));
			} else {
				set(out, kv.key, child(indent));
			}
		}
		return out;
	}

	function node(indent: number): unknown {
		let line = lines[i];
		if (isItem(line.text)) return items(indent);
		if (pair(line.text)) return entries(indent);
		i++;
		return inline(line.text, line.num);
	}

	let root = lines[0];
	if (!root) return null;

	let out = node(root.indent);
	let rest = lines[i];
	if (rest) {
		if (rest.indent !== root.indent) throw fail(rest.num, 'bad indentation');
		if (Array.isArray(out)) throw fail(rest.num, 'expected "- item"');
		throw fail(root.num, 'expected "key: value"');
	}
	return out;
}
