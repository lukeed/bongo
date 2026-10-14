import { enter, fallback, goto, keyword, leave, match, on, range, within } from "@twinkleplop/core";
import { define_grammar } from "@twinkleplop/core/compile";
import * as TOKENS from "@twinkleplop/core/tokens";

const RAW = "raw_handlebars_expression";
const SPACE = [" ", "\t", "\n", "\r"];
const SEAL = { seal: true };

const ASCII_ALPHA = range([
	["a", "z"],
	["A", "Z"],
]);

const NAME_CHARS = range([
	["a", "z"],
	["A", "Z"],
	["0", "9"],
	["-", "-"],
	["_", "_"],
	[":", ":"],
]);

const HELPER_CHARS = range([
	["a", "z"],
	["A", "Z"],
	["0", "9"],
	["-", "-"],
	["_", "_"],
	["$", "$"],
]);

const PARTIAL_CHARS = range([
	["a", "z"],
	["A", "Z"],
	["0", "9"],
	["-", "-"],
	["_", "_"],
	["$", "$"],
	[".", "."],
	["/", "/"],
	["@", "@"],
]);

function ascii_cases(word: string): string[] {
	let out: string[] = [];
	for (let mask = 0; mask < 1 << word.length; mask++) {
		let cased = "";
		for (let i = 0; i < word.length; i++) {
			cased += mask & (1 << i) ? word[i].toUpperCase() : word[i];
		}
		out.push(cased);
	}
	return out;
}

const SCRIPT = ascii_cases("script");
const STYLE = ascii_cases("style");

const MUSTACHE = [
	match(["{{!--", "{{~!--"], TOKENS.comment, enter("long_comment")),
	match(["{{!", "{{~!"], TOKENS.comment, enter("short_comment")),
	match("{{{{", TOKENS.punctuation, enter("raw_open")),
	match("{{{", TOKENS.expression, enter("triple_body")),
	on("{{", enter("open_probe")),
];

const BODY = [
	match('"', RAW, enter("string_double")),
	match("'", RAW, enter("string_single")),
	within("`", "`", RAW, { escape: "\\" }),
	fallback({ token: RAW }),
];

const INSIDE_TAG = [
	on(SPACE),
	match("=", TOKENS.operator),
	match('"', TOKENS.string, enter("attr_string_double")),
	match("'", TOKENS.string, enter("attr_string_single")),
	...MUSTACHE,
	match(NAME_CHARS, TOKENS.attr_name),
];

/**
 * The raw Handlebars grammar: HTML with mustaches in text, tags, attribute values, comments, and script or style bodies.
 *
 * @example
 * import { compile } from "@twinkleplop/core/compile";
 * import raw_grammar from "./grammar";
 * let grammar = compile(raw_grammar);
 */
export default define_grammar({
	name: "handlebars",
	states: {
		content: {
			rules: [
				match("<!--", TOKENS.comment, enter("html_comment")),
				match(["<!DOCTYPE", "<!doctype"], TOKENS.doctype, enter("doctype")),
				match("</", TOKENS.punctuation, enter("close_tag")),
				on("<", enter("lt_probe")),
				...MUSTACHE,
				fallback({}),
			],
		},

		html_comment: {
			rules: [
				match("-->", TOKENS.comment, leave()),
				...MUSTACHE,
				fallback({ token: TOKENS.comment }),
			],
		},

		lt_probe: {
			mode: "probe",
			fallback: "lt_text",
			rules: [
				on(ASCII_ALPHA, enter("lt_tag")),
				on("<", enter("lt_text_before_lt")),
				fallback(enter("lt_text")),
			],
		},

		lt_tag: {
			rules: [match("<", TOKENS.punctuation, goto("tag_start"))],
		},

		lt_text: {
			rules: [on("<"), fallback(leave())],
		},

		lt_text_before_lt: {
			rules: [match("<", TOKENS.punctuation, leave())],
		},

		tag_start: {
			rules: [
				keyword(SCRIPT, goto("script_attrs"), TOKENS.tag_name),
				keyword(STYLE, goto("style_attrs"), TOKENS.tag_name),
				match(NAME_CHARS, TOKENS.tag_name, goto("tag_open")),
			],
		},

		tag_open: {
			rules: [
				match("/>", TOKENS.punctuation, leave()),
				match(">", TOKENS.punctuation, leave()),
				on(SPACE, goto("tag_attrs")),
				...MUSTACHE,
				match(NAME_CHARS, TOKENS.tag_name),
			],
		},

		tag_attrs: {
			rules: [
				match("/>", TOKENS.punctuation, leave()),
				match(">", TOKENS.punctuation, leave()),
				...INSIDE_TAG,
			],
		},

		attr_string_double: {
			rules: [
				match('"', TOKENS.string, leave()),
				...MUSTACHE,
				fallback({ token: TOKENS.string }),
			],
		},

		attr_string_single: {
			rules: [
				match("'", TOKENS.string, leave()),
				...MUSTACHE,
				fallback({ token: TOKENS.string }),
			],
		},

		close_tag: {
			rules: [
				match(">", TOKENS.punctuation, leave()),
				on(SPACE),
				...MUSTACHE,
				match(NAME_CHARS, TOKENS.tag_name),
			],
		},

		doctype: {
			rules: [match(">", TOKENS.punctuation, leave()), fallback({ token: TOKENS.doctype })],
		},

		script_attrs: {
			rules: [
				match("/>", TOKENS.punctuation, leave()),
				match(">", TOKENS.punctuation, goto("script_content")),
				...INSIDE_TAG,
			],
		},

		script_content: {
			rules: [
				on("</", enter("script_close_probe")),
				...MUSTACHE,
				fallback({ token: TOKENS.raw_script }),
			],
		},

		script_close_probe: {
			mode: "probe",
			fallback: "script_close_fail",
			rules: [
				on(SCRIPT.map((name) => name + ">"), goto("script_close_emit")),
				fallback(enter("script_close_fail")),
			],
		},

		script_close_fail: {
			rules: [match("<", TOKENS.raw_script, leave())],
		},

		script_close_emit: {
			rules: [match("</", TOKENS.punctuation, goto("script_close_name"))],
		},

		script_close_name: {
			rules: [match(SCRIPT, TOKENS.tag_name, goto("script_close_gt"))],
		},

		script_close_gt: {
			rules: [match(">", TOKENS.punctuation, leave())],
		},

		style_attrs: {
			rules: [
				match("/>", TOKENS.punctuation, leave()),
				match(">", TOKENS.punctuation, goto("style_content")),
				...INSIDE_TAG,
			],
		},

		style_content: {
			rules: [
				on("</", enter("style_close_probe")),
				...MUSTACHE,
				fallback({ token: TOKENS.raw_style }),
			],
		},

		style_close_probe: {
			mode: "probe",
			fallback: "style_close_fail",
			rules: [
				on(STYLE.map((name) => name + ">"), goto("style_close_emit")),
				fallback(enter("style_close_fail")),
			],
		},

		style_close_fail: {
			rules: [match("<", TOKENS.raw_style, leave())],
		},

		style_close_emit: {
			rules: [match("</", TOKENS.punctuation, goto("style_close_name"))],
		},

		style_close_name: {
			rules: [match(STYLE, TOKENS.tag_name, goto("style_close_gt"))],
		},

		style_close_gt: {
			rules: [match(">", TOKENS.punctuation, leave())],
		},

		long_comment: {
			rules: [
				match(["--}}", "--~}}"], TOKENS.comment, leave()),
				fallback({ token: TOKENS.comment }),
			],
		},

		short_comment: {
			rules: [match("}}", TOKENS.comment, leave()), fallback({ token: TOKENS.comment })],
		},

		// looks past `{{`, `~`, and spaces: a sigil or `else` makes a block form with punctuation braces
		open_probe: {
			mode: "probe",
			fallback: "plain_open",
			rules: [
				on("~{", enter("triple_strip_open")),
				on(["~", ...SPACE]),
				on(["#", "/", "^", ">", "&", "*"], enter("block_open")),
				on("else", { boundary: true, ...enter("block_open") }),
				fallback(enter("plain_open")),
			],
		},

		plain_open: {
			rules: [
				match("{{", TOKENS.expression),
				match("~", TOKENS.punctuation, { ...SEAL, ...goto("plain_body") }),
				fallback(goto("plain_body")),
			],
		},

		plain_body: {
			rules: [
				on("~}}", enter("strip_probe")),
				match("}}", TOKENS.expression, leave()),
				...BODY,
			],
		},

		block_open: {
			rules: [
				match("{{", TOKENS.punctuation),
				on(SPACE),
				match("~", TOKENS.punctuation, SEAL),
				match("#", TOKENS.punctuation, { ...SEAL, ...goto("hash") }),
				match(["/", "^", "*"], TOKENS.punctuation, { ...SEAL, ...goto("block_name") }),
				match(">", TOKENS.punctuation, { ...SEAL, ...goto("partial_name") }),
				match("&", TOKENS.punctuation, { ...SEAL, ...goto("block_body") }),
				keyword(["else"], goto("block_name")),
			],
		},

		hash: {
			rules: [
				match(">", TOKENS.punctuation, { ...SEAL, ...goto("partial_name") }),
				match("*", TOKENS.punctuation, { ...SEAL, ...goto("block_name") }),
				fallback(goto("block_name")),
			],
		},

		block_name: {
			rules: [
				on(SPACE),
				match(HELPER_CHARS, TOKENS.keyword, goto("block_name_rest")),
				fallback(goto("block_body")),
			],
		},

		block_name_rest: {
			rules: [match(HELPER_CHARS, TOKENS.keyword), fallback(goto("block_body"))],
		},

		partial_name: {
			rules: [
				on(SPACE),
				match(PARTIAL_CHARS, TOKENS.function, goto("partial_name_rest")),
				fallback(goto("block_body")),
			],
		},

		partial_name_rest: {
			rules: [match(PARTIAL_CHARS, TOKENS.function), fallback(goto("block_body"))],
		},

		block_body: {
			rules: [
				on("~}}", enter("strip_probe")),
				match("}}", TOKENS.punctuation, leave()),
				...BODY,
			],
		},

		// a probe that resolves on its first char rewinds to the start of the `on` match
		strip_probe: {
			mode: "probe",
			fallback: "strip",
			rules: [fallback(enter("strip"))],
		},

		strip: {
			rules: [match("~", TOKENS.punctuation, { ...SEAL, ...leave() })],
		},

		triple_body: {
			rules: [
				on("}~}}", enter("triple_strip_probe")),
				match("}}}", TOKENS.expression, leave()),
				...BODY,
			],
		},

		triple_strip_open: {
			rules: [match("{{", TOKENS.expression, goto("triple_strip_brace"))],
		},

		triple_strip_brace: {
			rules: [
				on(SPACE),
				match("~", TOKENS.punctuation, SEAL),
				match("{", TOKENS.expression, { ...SEAL, ...goto("triple_body") }),
			],
		},

		triple_strip_probe: {
			mode: "probe",
			fallback: "triple_strip_close",
			rules: [fallback(goto("triple_strip_close"))],
		},

		triple_strip_close: {
			rules: [
				match("}", TOKENS.expression, SEAL),
				match("~", TOKENS.punctuation, SEAL),
				match("}}", TOKENS.expression, leave()),
			],
		},

		string_double: {
			rules: [
				match('"', RAW, leave()),
				match(["\\\\", '\\"'], RAW),
				on("\n", leave()),
				fallback({ token: RAW }),
			],
		},

		string_single: {
			rules: [
				match("'", RAW, leave()),
				match(["\\\\", "\\'"], RAW),
				on("\n", leave()),
				fallback({ token: RAW }),
			],
		},

		raw_open: {
			rules: [
				on(SPACE),
				match(HELPER_CHARS, TOKENS.keyword, goto("raw_open_rest")),
				fallback(goto("raw_open_body")),
			],
		},

		raw_open_rest: {
			rules: [match(HELPER_CHARS, TOKENS.keyword), fallback(goto("raw_open_body"))],
		},

		raw_open_body: {
			rules: [match("}}}}", TOKENS.punctuation, goto("raw_content")), ...BODY],
		},

		raw_content: {
			rules: [on("{{{{/", enter("raw_close_probe")), fallback({})],
		},

		raw_close_probe: {
			mode: "probe",
			fallback: "raw_close",
			rules: [fallback(goto("raw_close"))],
		},

		raw_close: {
			rules: [
				match("{{{{", TOKENS.punctuation),
				match("/", TOKENS.punctuation, { ...SEAL, ...goto("raw_close_name") }),
			],
		},

		raw_close_name: {
			rules: [
				on(SPACE),
				match(HELPER_CHARS, TOKENS.keyword),
				match("}}}}", TOKENS.punctuation, leave()),
				fallback(leave()),
			],
		},
	},
});
