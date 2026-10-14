import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { tokenize as tokenize_raw, visible_text } from "@twinkleplop/core";
import { grammar, language, tokenize } from "./index";

import type { TokenizeResult } from "@twinkleplop/core";

type Token = { type: string; start: number; end: number };

const ROOT = join(import.meta.dirname, "../../..");
const TEMPLATES = [
	"example/layouts/**/*.hbs",
	"packages/create-bongo/template/layouts/**/*.hbs",
	"packages/create-bongo/template/partials/*.hbs",
];
const READMES = ["packages/bongo/readme.md", "packages/plugin.feed/readme.md"];
const DELIMITERS = ["expression", "punctuation", "comment"];
const HTML_NAMES = ["tag_name", "attr_name", "string"];

function fixtures(): [string, string][] {
	let out: [string, string][] = [];
	for (let file of globSync(TEMPLATES, { cwd: ROOT }).sort()) {
		out.push([file, readFileSync(join(ROOT, file), "utf8")]);
	}
	for (let file of READMES) {
		let text = readFileSync(join(ROOT, file), "utf8");
		let n = 0;
		for (let fence of text.matchAll(/^```hbs\n([\s\S]*?)^```$/gm)) {
			out.push([`${file} hbs#${++n}`, fence[1]]);
		}
	}
	return out;
}

function tokens_of(result: TokenizeResult): Token[] {
	let out: Token[] = [];
	for (let i = 0; i < result.tokens.length / 3; i++) {
		out.push({
			type: result.token_types[result.tokens[i * 3]],
			start: result.tokens[i * 3 + 1],
			end: result.tokens[i * 3 + 2],
		});
	}
	return out;
}

function check(src: string, tokens: Token[]) {
	let rebuilt = "";
	let cursor = 0;
	for (let token of tokens) {
		expect(token.start).toBeGreaterThanOrEqual(cursor);
		expect(token.end).toBeGreaterThan(token.start);
		rebuilt += src.slice(cursor, token.end);
		cursor = token.end;
	}
	expect(cursor).toBeLessThanOrEqual(src.length);
	expect(rebuilt + src.slice(cursor)).toBe(src);

	for (let token of tokens) {
		if (!HTML_NAMES.includes(token.type)) continue;
		let text = src.slice(token.start, token.end);
		expect(text).not.toContain("{{");
		expect(text).not.toContain("}}");
	}

	for (let delimiter of ["{{", "}}"]) {
		for (let at = src.indexOf(delimiter); at !== -1; at = src.indexOf(delimiter, at + 1)) {
			let owner = tokens.find((token) => token.start <= at && at < token.end);
			expect(DELIMITERS).toContain(owner?.type ?? "untokenized");
		}
	}
}

function strip_html(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

const ALL = fixtures();
const run = tokenize();
const render = language();

describe("handlebars fixtures — bongo templates", () => {
	it("finds fixtures in every source", () => {
		for (let source of [...TEMPLATES, ...READMES]) {
			let prefix = source.split("*")[0];
			expect(ALL.some((entry) => entry[0].startsWith(prefix))).toBe(true);
		}
	});

	for (let [name, src] of ALL) {
		it(`${name} — raw grammar`, () => {
			check(src, tokens_of(tokenize_raw(src, grammar)));
		});

		it(`${name} — full pipeline`, () => {
			let result = run(src);
			let tokens = tokens_of(result);
			check(src, tokens);
			expect(tokens.filter((token) => token.type.startsWith("raw_"))).toEqual([]);
			expect(visible_text(src, result)).toBe(src);
			expect(strip_html(render(src))).toBe(src);
		});
	}
});
