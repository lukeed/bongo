import { describe, expect, it } from "bun:test";
import { tokenize } from "@twinkleplop/core";
import { verify } from "@twinkleplop/core/compile";
import { grammar, raw_grammar } from "./index";

const RAW = "raw_handlebars_expression";

function pairs(src: string): string[][] {
	let result = tokenize(src, grammar);
	let out: string[][] = [];
	for (let i = 0; i < result.tokens.length / 3; i++) {
		let type = result.token_types[result.tokens[i * 3]];
		out.push([type, src.slice(result.tokens[i * 3 + 1], result.tokens[i * 3 + 2])]);
	}
	return out;
}

function values(src: string, type: string): string[] {
	return pairs(src)
		.filter((pair) => pair[0] === type)
		.map((pair) => pair[1]);
}

describe("handlebars grammar — integrity", () => {
	it("has no unused states or bad transitions", () => {
		expect(verify(raw_grammar)).toEqual([]);
	});
});

describe("handlebars grammar — HTML structure", () => {
	it("tokenizes a self-closing tag", () => {
		expect(pairs("<br/>")).toEqual([
			["punctuation", "<"],
			["tag_name", "br"],
			["punctuation", "/>"],
		]);
	});

	it("tokenizes an open and close tag pair", () => {
		expect(pairs("<p>hi</p>")).toEqual([
			["punctuation", "<"],
			["tag_name", "p"],
			["punctuation", ">"],
			["punctuation", "</"],
			["tag_name", "p"],
			["punctuation", ">"],
		]);
	});

	it("tokenizes attributes with quoted and bare values", () => {
		let src = `<input type="text" name='q' required>`;
		expect(values(src, "attr_name")).toEqual(["type", "name", "required"]);
		expect(values(src, "string")).toEqual(['"text"', "'q'"]);
		expect(values(src, "operator")).toEqual(["=", "="]);
	});

	it("keeps `:` in tag and attribute names", () => {
		let src = `<bongo:style src="a.css"></bongo:style><header transition:name="x">`;
		expect(values(src, "tag_name")).toEqual(["bongo:style", "bongo:style", "header"]);
		expect(values(src, "attr_name")).toEqual(["src", "transition:name"]);
	});

	it("tokenizes an HTML comment", () => {
		expect(values("<!-- hi -->", "comment").join("")).toBe("<!-- hi -->");
	});

	it("tokenizes a doctype", () => {
		expect(pairs("<!doctype html>")).toEqual([
			["doctype", "<!doctype html"],
			["punctuation", ">"],
		]);
	});

	it("leaves text and a `<` before a non-letter untokenized", () => {
		expect(pairs("a < b <3")).toEqual([]);
		expect(pairs(`<?xml version="1.0"?>`)).toEqual([]);
	});

	it("emits raw_script and raw_style bodies", () => {
		let src = `<script type="module">let a = "</p>";</script><style>a { color: red }</style>`;
		expect(values(src, "raw_script")).toEqual([`let a = "</p>";`]);
		expect(values(src, "raw_style")).toEqual(["a { color: red }"]);
		expect(values(src, "tag_name")).toEqual(["script", "script", "style", "style"]);
	});

	it("keeps other close tags inside script and style bodies", () => {
		expect(values(`<script>a("</p>", "</scripts>")</script>`, "raw_script")).toEqual([
			`a("</p>", "</scripts>")`,
		]);
		expect(values(`<style>a::after { content: "</b>" }</style>`, "raw_style")).toEqual([
			`a::after { content: "</b>" }`,
		]);
		expect(values("<script>a </", "raw_script")).toEqual(["a </"]);
	});

	it("matches script and style tags in any case", () => {
		expect(values("<SCRIPT>x</Script>", "raw_script")).toEqual(["x"]);
	});

	it("does not read `<noscript>` as a script", () => {
		let src = "<noscript>hi</noscript>";
		expect(values(src, "raw_script")).toEqual([]);
		expect(values(src, "tag_name")).toEqual(["noscript", "noscript"]);
	});
});

describe("handlebars grammar — interpolation", () => {
	it("tokenizes `{{ expr }}`", () => {
		expect(pairs("{{ $page.title }}")).toEqual([
			["expression", "{{"],
			[RAW, " $page.title "],
			["expression", "}}"],
		]);
	});

	it("tokenizes `{{{ raw }}}`", () => {
		expect(pairs("{{{ $page.content }}}")).toEqual([
			["expression", "{{{"],
			[RAW, " $page.content "],
			["expression", "}}}"],
		]);
	});

	it("splits whitespace control from the braces", () => {
		expect(pairs("{{~ x ~}}")).toEqual([
			["expression", "{{"],
			["punctuation", "~"],
			[RAW, " x "],
			["punctuation", "~"],
			["expression", "}}"],
		]);
	});

	it("splits whitespace control on a triple stash", () => {
		expect(pairs("{{~{ x }~}}")).toEqual([
			["expression", "{{"],
			["punctuation", "~"],
			["expression", "{"],
			[RAW, " x "],
			["expression", "}"],
			["punctuation", "~"],
			["expression", "}}"],
		]);
	});

	it("keeps a `~` that does not touch the braces in the body", () => {
		expect(pairs("{{ ~x }}")).toEqual([
			["expression", "{{"],
			[RAW, " ~x "],
			["expression", "}}"],
		]);
	});

	it("skips `}}` inside strings", () => {
		expect(values(`{{ t "a}}b" }}`, RAW).join("")).toBe(` t "a}}b" `);
		expect(values(`{{ t 'a}}b' }}`, RAW).join("")).toBe(` t 'a}}b' `);
		expect(values("{{ `a}}${b}` }}", RAW).join("")).toBe(" `a}}${b}` ");
		expect(values(`{{ "a\\"}}" }}`, RAW).join("")).toBe(` "a\\"}}" `);
		expect(values(`{{{ "}}}" }}}`, RAW).join("")).toBe(` "}}}" `);
	});

	it("ends an unclosed string at the line break", () => {
		expect(pairs(`{{ "a\n }}b`)).toEqual([
			["expression", "{{"],
			[RAW, ` "a\n `],
			["expression", "}}"],
		]);
	});

	it("closes at the first `}}` outside a string, like tempura", () => {
		expect(pairs("{{ {a: 1}}}")).toEqual([
			["expression", "{{"],
			[RAW, " {a: 1"],
			["expression", "}}"],
		]);
	});

	it("reads `{{elsewhere}}` as a plain interpolation", () => {
		expect(pairs("{{elsewhere}}")).toEqual([
			["expression", "{{"],
			[RAW, "elsewhere"],
			["expression", "}}"],
		]);
	});

	it("survives an unclosed mustache at the end of input", () => {
		expect(pairs("{{ x")).toEqual([
			["expression", "{{"],
			[RAW, " x"],
		]);
		expect(pairs("{{")).toEqual([["expression", "{{"]]);
	});
});

describe("handlebars grammar — comments", () => {
	it("tokenizes `{{! … }}`", () => {
		expect(values("{{! layouts/html.hbs }}", "comment").join("")).toBe("{{! layouts/html.hbs }}");
	});

	it("tokenizes `{{!-- … --}}` with `}}` inside", () => {
		let src = "{{!-- a }} b --}}x";
		expect(values(src, "comment").join("")).toBe("{{!-- a }} b --}}");
		expect(pairs(src).every((pair) => pair[0] === "comment")).toBe(true);
	});

	it("tokenizes comments with whitespace control", () => {
		let src = "{{~!-- a --~}}{{~! b ~}}";
		expect(pairs(src).every((pair) => pair[0] === "comment")).toBe(true);
		expect(values(src, "comment").join("")).toBe(src);
	});
});

describe("handlebars grammar — Handlebars blocks", () => {
	it("tokenizes `{{#if}}…{{else if}}…{{else}}…{{/if}}`", () => {
		expect(pairs("{{#if a}}{{else if b}}{{else}}{{/if}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "#"],
			["keyword", "if"],
			[RAW, " a"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["keyword", "else"],
			["keyword", "if"],
			[RAW, " b"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["keyword", "else"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["punctuation", "/"],
			["keyword", "if"],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{^}}` and `{{^name}}`", () => {
		expect(pairs("{{^}}{{^items}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "^"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["punctuation", "^"],
			["keyword", "items"],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{> partial arg=1}}`", () => {
		expect(pairs("{{> nav arg=1}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", ">"],
			["function", "nav"],
			[RAW, " arg=1"],
			["punctuation", "}}"],
		]);
	});

	it("reads partial names with paths and `@`", () => {
		expect(values("{{> partials/site-nav.hbs}}{{> @partial-block }}", "function")).toEqual([
			"partials/site-nav.hbs",
			"@partial-block",
		]);
	});

	it("leaves a dynamic partial name to the body", () => {
		expect(pairs("{{> (pick name) }}")).toEqual([
			["punctuation", "{{"],
			["punctuation", ">"],
			[RAW, "(pick name) "],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{#> layout}}`", () => {
		expect(pairs("{{#> layout}}{{/layout}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "#"],
			["punctuation", ">"],
			["function", "layout"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["punctuation", "/"],
			["keyword", "layout"],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{#*inline \"x\"}}`", () => {
		expect(pairs(`{{#*inline "x"}}`)).toEqual([
			["punctuation", "{{"],
			["punctuation", "#"],
			["punctuation", "*"],
			["keyword", "inline"],
			[RAW, ` "x"`],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{&name}}` with the name in the body", () => {
		expect(pairs("{{&name}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "&"],
			[RAW, "name"],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes whitespace control on a block", () => {
		expect(pairs("{{~#each items~}}{{~else~}}{{~/each~}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "~"],
			["punctuation", "#"],
			["keyword", "each"],
			[RAW, " items"],
			["punctuation", "~"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["punctuation", "~"],
			["keyword", "else"],
			["punctuation", "~"],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["punctuation", "~"],
			["punctuation", "/"],
			["keyword", "each"],
			["punctuation", "~"],
			["punctuation", "}}"],
		]);
	});

	it("allows spaces around the sigil, like tempura", () => {
		expect(pairs("{{ # if x }}{{ else }}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "#"],
			["keyword", "if"],
			[RAW, " x "],
			["punctuation", "}}"],
			["punctuation", "{{"],
			["keyword", "else"],
			["punctuation", "}}"],
		]);
	});

	it("reads Handlebars block params as body", () => {
		expect(values("{{#each items as |item i|}}", RAW)).toEqual([" items as |item i|"]);
	});

	it("tokenizes a raw block and leaves its content as text", () => {
		expect(pairs("{{{{raw}}}} {{x}} <b> {{{{/raw}}}}")).toEqual([
			["punctuation", "{{{{"],
			["keyword", "raw"],
			["punctuation", "}}}}"],
			["punctuation", "{{{{"],
			["punctuation", "/"],
			["keyword", "raw"],
			["punctuation", "}}}}"],
		]);
	});

	it("passes raw block arguments to the body", () => {
		expect(values("{{{{raw-helper a=1}}}}x{{{{/raw-helper}}}}", RAW)).toEqual([" a=1"]);
	});
});

describe("handlebars grammar — tempura blocks", () => {
	it("tokenizes `{{#if}}`, `{{#elif}}`, `{{#else}}`, `{{/if}}`", () => {
		expect(values("{{#if a}}{{#elif b}}{{#else}}{{/if}}", "keyword")).toEqual([
			"if",
			"elif",
			"else",
			"if",
		]);
	});

	it("tokenizes `{{#each items as item, i}}`", () => {
		expect(pairs("{{#each items as item, i}}")).toEqual([
			["punctuation", "{{"],
			["punctuation", "#"],
			["keyword", "each"],
			[RAW, " items as item, i"],
			["punctuation", "}}"],
		]);
	});

	it("tokenizes `{{#var name = value}}`", () => {
		let src = "{{#var posts = $section.filter(p => p.params.date).toSorted((a, b) => b - a)}}";
		expect(values(src, "keyword")).toEqual(["var"]);
		expect(values(src, RAW).join("")).toBe(" posts = $section.filter(p => p.params.date).toSorted((a, b) => b - a)");
	});

	it("tokenizes `{{#expect a, b}}`", () => {
		expect(values("{{#expect date, tags }}", RAW)).toEqual([" date, tags "]);
	});

	it("tokenizes `{{#partial src=… title=…}}`", () => {
		let src = `{{#partial src="nav" title="Hi"}}`;
		expect(values(src, "keyword")).toEqual(["partial"]);
		expect(values(src, RAW).join("")).toBe(` src="nav" title="Hi"`);
	});
});

describe("handlebars grammar — mustaches in markup", () => {
	it("tokenizes a block inside a tag's attribute list", () => {
		let src = "<div {{#if x}}hidden{{/if}}>";
		expect(values(src, "attr_name")).toEqual(["hidden"]);
		expect(values(src, "keyword")).toEqual(["if", "if"]);
		expect(values(src, "tag_name")).toEqual(["div"]);
	});

	it("tokenizes a mustache inside a double-quoted value", () => {
		expect(pairs(`<a href="/x/{{ post.path }}/">`)).toEqual([
			["punctuation", "<"],
			["tag_name", "a"],
			["attr_name", "href"],
			["operator", "="],
			["string", '"/x/'],
			["expression", "{{"],
			[RAW, " post.path "],
			["expression", "}}"],
			["string", '/"'],
			["punctuation", ">"],
		]);
	});

	it("tokenizes a mustache with a string inside a single-quoted value", () => {
		let src = `<a title='{{ t "x" }}'>`;
		expect(values(src, "string")).toEqual(["'", "'"]);
		expect(values(src, RAW).join("")).toBe(` t "x" `);
	});

	it("tokenizes a block inside a quoted value", () => {
		let src = `<p class="a {{#if on}}on{{/if}}">`;
		expect(values(src, "string").join("")).toBe(`"a on"`);
		expect(values(src, "keyword")).toEqual(["if", "if"]);
	});

	it("tokenizes an unquoted mustache value", () => {
		expect(pairs("<img src={{src}}/>")).toEqual([
			["punctuation", "<"],
			["tag_name", "img"],
			["attr_name", "src"],
			["operator", "="],
			["expression", "{{"],
			[RAW, "src"],
			["expression", "}}"],
			["punctuation", "/>"],
		]);
	});

	it("tokenizes a mustache inside tag names", () => {
		let src = "<h{{level}} id=x>t</h{{level}}>";
		expect(values(src, "tag_name")).toEqual(["h", "h"]);
		expect(values(src, RAW)).toEqual(["level", "level"]);
		expect(values(src, "attr_name")).toEqual(["id", "x"]);
	});

	it("tokenizes a mustache inside an HTML comment", () => {
		let src = "<!-- built {{ date }} -->";
		expect(values(src, "comment").join("")).toBe("<!-- built  -->");
		expect(values(src, RAW)).toEqual([" date "]);
	});

	it("tokenizes mustaches inside script and style bodies", () => {
		let src = `<script>let u = "/{{ id }}";</script><style>a { color: {{{ c }}} }</style>`;
		expect(values(src, "raw_script")).toEqual([`let u = "/`, `";`]);
		expect(values(src, "raw_style")).toEqual(["a { color: ", " }"]);
		expect(values(src, RAW)).toEqual([" id ", " c "]);
	});

	it("tokenizes a hbs comment inside a tag", () => {
		let src = "<p {{! note }} id=a>";
		expect(values(src, "comment").join("")).toBe("{{! note }}");
		expect(values(src, "attr_name")).toEqual(["id", "a"]);
	});
});
