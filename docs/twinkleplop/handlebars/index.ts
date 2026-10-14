import { create_language, to_html } from "@twinkleplop/core";
import { compile } from "@twinkleplop/core/compile";
import raw_grammar from "./grammar";
import { reclassifiers } from "./reclassifiers";

import type { LanguageOptions, RenderOptions } from "@twinkleplop/core";

/**
 * The compiled grammar, for bare Handlebars tokens without JavaScript or CSS embedding.
 *
 * @example
 * import { tokenize } from "@twinkleplop/core";
 * let result = tokenize("{{ title }}", grammar);
 */
export const grammar = compile(raw_grammar);

/**
 * Build a tokenizer that returns token data, for custom renderers.
 *
 * @example
 * let run = tokenize();
 * let { tokens, token_types } = run("<h1>{{ $page.title }}</h1>");
 */
export const tokenize = create_language(grammar, reclassifiers);

/**
 * Build a highlighter that returns HTML.
 *
 * @example
 * let highlight = language();
 * let html = highlight("{{#if ok}}<b>{{ name }}</b>{{/if}}");
 */
export function language(options?: LanguageOptions): (input: string, render?: RenderOptions) => string {
	let run = tokenize(options);
	return (input, render) => to_html(input, run(input), render);
}

export { raw_grammar, reclassifiers };
