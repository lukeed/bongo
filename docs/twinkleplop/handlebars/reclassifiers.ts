import { always, embed_grammars, embed_interleaved } from "@twinkleplop/core";
import { tokenize as css_tokenize } from "@twinkleplop/css";
import { tokenize as js_tokenize } from "@twinkleplop/javascript";

import type { GroupDescriptor, LanguageFn, LanguagePipeline, Region } from "@twinkleplop/core";

const HOLES = new Set([
	"comment",
	"expression",
	"function",
	"keyword",
	"punctuation",
	"raw_handlebars_expression",
]);

let js_fn: LanguageFn | undefined;
let css_fn: LanguageFn | undefined;
const js_default = (src: string) => (js_fn ??= js_tokenize())(src);
const css_default = (src: string) => (css_fn ??= css_tokenize())(src);

function scan(tokens: Uint32Array, _input: string, start: number, types: string[]): GroupDescriptor | null {
	let kind = tokens[start * 3];
	let name = types[kind];
	if (name !== "raw_script" && name !== "raw_style") return null;

	let count = tokens.length / 3;
	let last = start;
	for (let i = start + 1; i < count; i++) {
		let type = tokens[i * 3];
		if (type === kind) last = i;
		else if (!HOLES.has(types[type])) break;
	}

	let regions: Region[] = [];
	let values = new Set<number>();
	let origin = tokens[start * 3 + 1];
	let cursor = origin;
	for (let i = start + 1; i <= last; i++) {
		if (tokens[i * 3] === kind) continue;
		let stop = i;
		while (tokens[stop * 3] !== kind) stop++;
		let hole_start = tokens[i * 3 + 1];
		let hole_end = tokens[(stop - 1) * 3 + 2];
		if (types[tokens[i * 3]] === "expression") values.add(hole_start);
		if (hole_start > cursor) {
			regions.push({ kind: "content", source_start: cursor, source_end: hole_start });
		}
		regions.push({
			kind: "hole",
			source_start: hole_start,
			source_end: hole_end,
			token_start: i,
			token_end: stop,
		});
		cursor = hole_end;
		i = stop;
	}
	let end = tokens[last * 3 + 2];
	if (end > cursor) regions.push({ kind: "content", source_start: cursor, source_end: end });

	if (name === "raw_style") {
		return { token_start: start, token_end: last + 1, regions, language: css_default };
	}

	return {
		token_start: start,
		token_end: last + 1,
		regions,
		language: js_default,
		// a value fills as an identifier, so JavaScript reads a `/` after it as division
		fill_hole: (source, length) => (values.has(origin + source.length) ? "_" : " ").repeat(length),
	};
}

/**
 * The default pipeline: `<script>` and `<style>` bodies become JavaScript and CSS with their mustaches kept as holes, then every mustache body becomes JavaScript.
 *
 * @example
 * import { create_language } from "@twinkleplop/core";
 * import { grammar, reclassifiers } from "./index";
 * let tokenize = create_language(grammar, [...reclassifiers, my_pass]);
 */
export const reclassifiers: LanguagePipeline = [
	always(embed_interleaved({ scan, trigger_types: ["raw_script", "raw_style"] }), "embed"),
	always(embed_grammars({ raw_handlebars_expression: js_default }), "embed"),
];
