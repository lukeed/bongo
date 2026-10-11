import * as yaml from './yaml';

export type Attrs = Record<string, unknown>;

const NAME = /\s*([^\s=/>"'`]+)/y;
const EQUALS = /\s*=\s*/y;
const WORD = /[^\s>]*/y;
const OPENERS = '"\'`[{';

/**
 * Parse element attributes as data, never as code.
 * `"…"`, `'…'`, and `` `…` `` values are strings with JavaScript escapes (no interpolation).
 * A bare value is a number, `true`, `false`, `null`, or else text, so `src=img/a.png` works.
 * `{…}` and `[…]` values are JSON5-like maps and lists. A name with no value is `true`.
 * @example parse('src="a.css" inline n=2 opts={a: 1}') //=> { src: 'a.css', inline: true, n: 2, opts: { a: 1 } }
 */
export function parse(input: string): Attrs {
	let pairs: [string, unknown][] = [];
	let pos = 0;

	while (pos < input.length) {
		NAME.lastIndex = pos;
		let name = NAME.exec(input);
		if (!name) {
			pos++;
			continue;
		}

		pos = NAME.lastIndex;
		EQUALS.lastIndex = pos;
		if (!EQUALS.test(input)) {
			pairs.push([name[1], true]);
			continue;
		}

		pos = EQUALS.lastIndex;
		let c = input[pos];
		let opened = c !== undefined && OPENERS.includes(c);
		let hit = opened ? yaml.read(input, pos, true) : undefined;
		if (hit) {
			pairs.push([name[1], hit.value]);
			pos = hit.end;
			continue;
		}

		WORD.lastIndex = pos;
		let word = WORD.exec(input)?.[0] ?? '';
		pairs.push([name[1], opened || !word ? word : yaml.scalar(word)]);
		pos += word.length;
	}

	return Object.fromEntries(pairs);
}
