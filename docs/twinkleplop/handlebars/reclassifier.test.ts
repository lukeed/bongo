import { describe, expect, it } from "bun:test";
import { language, tokenize } from "./index";

const run = tokenize();

function pairs(src: string, result = run(src)): string[][] {
	let out: string[][] = [];
	for (let i = 0; i < result.tokens.length / 3; i++) {
		let type = result.token_types[result.tokens[i * 3]];
		out.push([type, src.slice(result.tokens[i * 3 + 1], result.tokens[i * 3 + 2])]);
	}
	return out;
}

function type_of(src: string, value: string): string | undefined {
	return pairs(src).find((pair) => pair[1] === value)?.[0];
}

describe("handlebars language — expression embedding", () => {
	it("tokenizes an interpolation as JavaScript", () => {
		expect(pairs("<h1>{{ $page.title }}</h1>")).toEqual([
			["punctuation", "<"],
			["tag_name", "h1"],
			["punctuation", ">"],
			["expression", "{{"],
			["identifier", "$page"],
			["punctuation", "."],
			["identifier", "title"],
			["expression", "}}"],
			["punctuation", "</"],
			["tag_name", "h1"],
			["punctuation", ">"],
		]);
	});

	it("tokenizes calls, arrows, and operators", () => {
		let src = "{{#var posts = $section.filter(p => p.params.date).toSorted((a, b) => b - a)}}";
		expect(type_of(src, "var")).toBe("keyword");
		expect(type_of(src, "posts")).toBe("identifier");
		expect(type_of(src, "filter")).toBe("function");
		expect(type_of(src, "toSorted")).toBe("function");
		expect(type_of(src, "p")).toBe("parameter");
		expect(type_of(src, "=>")).toBe("operator");
		expect(pairs(src).some((pair) => pair[0] === "raw_handlebars_expression")).toBe(false);
	});

	it("tokenizes tempura `each` heads", () => {
		let src = "{{#each sorted as (p)}}{{#each items as item, i}}";
		expect(type_of(src, "each")).toBe("keyword");
		expect(type_of(src, "as")).toBe("keyword");
		expect(type_of(src, "sorted")).toBe("identifier");
		expect(type_of(src, "item")).toBe("identifier");
	});

	it("tokenizes hash arguments", () => {
		let src = `{{#partial src="nav" title="Hi" n=1}}{{> card big=true}}`;
		expect(pairs(src).filter((pair) => pair[0] === "string").map((pair) => pair[1])).toEqual([`"nav"`, `"Hi"`]);
		expect(type_of(src, "src")).toBe("identifier");
		expect(type_of(src, "1")).toBe("number");
		expect(type_of(src, "card")).toBe("function");
	});

	it("tokenizes a string with `}}` inside as one JavaScript string", () => {
		expect(pairs(`{{ t "a}}b" }}`)).toEqual([
			["expression", "{{"],
			["identifier", "t"],
			["string", `"a}}b"`],
			["expression", "}}"],
		]);
	});

	it("tokenizes a template literal body", () => {
		let src = "<p>{{ `hi ${name}` }}</p>";
		expect(type_of(src, "name")).toBe("identifier");
		expect(pairs(src).some((pair) => pair[0] === "template")).toBe(true);
	});

	it("tokenizes interpolations inside attribute values", () => {
		let src = `<a href="{{ post.path }}" title={{title}}>`;
		expect(type_of(src, "post")).toBe("identifier");
		expect(type_of(src, "title")).toBe("attr_name");
		expect(pairs(src).filter((pair) => pair[0] === "identifier").map((pair) => pair[1])).toEqual([
			"post",
			"path",
			"title",
		]);
	});
});

describe("handlebars language — brace types", () => {
	function braces(src: string): string[][] {
		return pairs(src).filter((pair) => /^[{}]+$/.test(pair[1]));
	}

	it("keeps value outputs as `expression`", () => {
		expect(braces("{{ a }}{{{ b }}}{{~ c ~}}")).toEqual([
			["expression", "{{"],
			["expression", "}}"],
			["expression", "{{{"],
			["expression", "}}}"],
			["expression", "{{"],
			["expression", "}}"],
		]);
	});

	it("types every block form as `punctuation`", () => {
		let src = [
			"{{#if a}}",
			"{{else if b}}",
			"{{else}}",
			"{{^}}",
			"{{^items}}",
			"{{/if}}",
			"{{> nav}}",
			"{{#> layout}}",
			`{{#*inline "x"}}`,
			"{{&html}}",
			"{{~#each xs~}}",
			"{{#elif c}}",
			"{{#var a = 1}}",
			"{{#expect a, b}}",
		].join("");
		let found = braces(src);
		expect(found).toHaveLength(28);
		expect(found.every((pair) => pair[0] === "punctuation")).toBe(true);
	});

	it("types raw block braces as `punctuation`", () => {
		expect(braces("{{{{raw}}}}{{x}}{{{{/raw}}}}")).toEqual([
			["punctuation", "{{{{"],
			["punctuation", "}}}}"],
			["punctuation", "{{{{"],
			["punctuation", "}}}}"],
		]);
	});

	it("keeps comments whole", () => {
		let src = "{{! a }}{{!-- {{b}} --}}";
		expect(pairs(src).every((pair) => pair[0] === "comment")).toBe(true);
	});
});

describe("handlebars language — script and style embedding", () => {
	it("tokenizes a <script> body as JavaScript", () => {
		let src = "<script>let count = 0; const inc = () => count++;</script>";
		expect(type_of(src, "let")).toBe("keyword");
		expect(type_of(src, "inc")).toBe("function");
		expect(pairs(src).some((pair) => pair[0] === "raw_script")).toBe(false);
	});

	it("tokenizes a <style> body as CSS", () => {
		let src = "<style>.btn { color: red; }</style>";
		expect(type_of(src, ".btn")).toBe("selector_class");
		expect(type_of(src, "color")).toBe("property");
		expect(pairs(src).some((pair) => pair[0] === "raw_style")).toBe(false);
	});

	it("keeps a JavaScript string whole around a mustache", () => {
		expect(pairs(`<script>let u = "/api/{{ id }}";</script>`)).toEqual([
			["punctuation", "<"],
			["tag_name", "script"],
			["punctuation", ">"],
			["keyword", "let"],
			["identifier", "u"],
			["operator", "="],
			["string", `"/api/`],
			["expression", "{{"],
			["identifier", "id"],
			["expression", "}}"],
			["string", `"`],
			["punctuation", ";"],
			["punctuation", "</"],
			["tag_name", "script"],
			["punctuation", ">"],
		]);
	});

	it("tokenizes block mustaches between statements", () => {
		let src = "<script>{{#if dev}}debug();{{/if}}go();</script>";
		expect(type_of(src, "debug")).toBe("function");
		expect(type_of(src, "go")).toBe("function");
		expect(type_of(src, "dev")).toBe("identifier");
		expect(pairs(src).filter((pair) => pair[0] === "keyword").map((pair) => pair[1])).toEqual(["if", "if"]);
	});

	it("reads a `/` after a value mustache as division", () => {
		let src = "<script>let r = {{ a }} / 2 / {{{ b }}};</script>";
		expect(pairs(src).filter((pair) => pair[1] === "/")).toEqual([
			["operator", "/"],
			["operator", "/"],
		]);
		expect(pairs(src).some((pair) => pair[0] === "regex")).toBe(false);
	});

	it("tokenizes a script that is only a mustache", () => {
		expect(pairs("<script>{{{ json }}}</script>").slice(3, 6)).toEqual([
			["expression", "{{{"],
			["identifier", "json"],
			["expression", "}}}"],
		]);
	});

	it("tokenizes a CSS value around a mustache", () => {
		let src = "<style>:root { --accent: {{ color }}; }</style>";
		expect(type_of(src, "--accent")).toBe("css_variable");
		expect(type_of(src, "color")).toBe("identifier");
		expect(type_of(src, "}")).toBe("punctuation");
	});

	it("embeds each script on its own", () => {
		let src = `<script>let a = "</script><p>{{ b }}</p><script>";</script>`;
		expect(type_of(src, "a")).toBe("identifier");
		expect(type_of(src, "p")).toBe("tag_name");
		expect(type_of(src, "b")).toBe("identifier");
	});
});

describe("handlebars language — options and rendering", () => {
	it("keeps embedding at low fidelity", () => {
		let src = "{{ a.b }}<script>let c;</script>";
		let low = pairs(src, tokenize({ fidelity: "low" })(src));
		expect(low.some((pair) => pair[0].startsWith("raw_"))).toBe(false);
		expect(low.find((pair) => pair[1] === "let")?.[0]).toBe("keyword");
	});

	it("renders HTML", () => {
		let html = language()(`<a href="{{ url }}">{{#if ok}}yes{{/if}}</a>`);
		expect(html).toContain(`<span class="tok expression">{{</span>`);
		expect(html).toContain(`<span class="tok identifier">url</span>`);
		expect(html).toContain(`<span class="tok keyword">if</span>`);
		expect(html).toContain(`<span class="tok tag_name">a</span>`);
		expect(html).not.toContain("raw_");
	});
});
