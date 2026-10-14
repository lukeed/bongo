# handlebars

A Handlebars language for the [twinkleplop](https://github.com/pngwn/twinkleplop) syntax highlighter. It reads Handlebars and [tempura](https://github.com/lukeed/tempura) templates. The files follow the layout of the upstream language packages, so this folder can become `@twinkleplop/handlebars` later.

## What it highlights

- HTML, the same as `@twinkleplop/html`: tags, attributes, comments, the doctype, and `<script>` and `<style>` bodies as JavaScript and CSS. Tag and attribute names can hold `:`, as in `<bongo:style>` and `transition:name`.
- Mustaches in text, in tag names, in the attribute list, in quoted and unquoted attribute values, in HTML comments, and in `<script>` and `<style>` bodies.
- Handlebars forms: `{{ expr }}`, `{{{ raw }}}`, `{{~ x ~}}`, `{{! x }}`, `{{!-- x --}}`, `{{#name x}}`, `{{/name}}`, `{{else}}`, `{{else if x}}`, `{{^}}`, `{{^name}}`, `{{> partial a=1}}`, `{{#> layout}}`, `{{#*inline "x"}}`, `{{&name}}`, and raw blocks `{{{{raw}}}}…{{{{/raw}}}}`.
- tempura forms: `{{#if x}}`, `{{#elif x}}`, `{{#else}}`, `{{#each items as item, i}}`, `{{#var name = value}}`, `{{#expect a, b}}`, and custom blocks such as `{{#partial src="nav" title="Hi"}}`.

## Token model

| Text | Token |
| --- | --- |
| `{{` `}}` `{{{` `}}}` of a value output: `{{ x }}`, `{{{ x }}}`, `{{~ x ~}}` | `expression` |
| `{{` `}}` of a block form, and `{{{{` `}}}}` of a raw block | `punctuation` |
| sigils `#` `/` `^` `>` `&` `*` and the strip mark `~` | `punctuation` |
| the name after `#`, `/`, `^`, `*`, `{{{{`, and the word `else` | `keyword` |
| the partial name after `>` | `function` |
| the expression body | `raw_handlebars_expression`, then JavaScript tokens |
| `{{! x }}` and `{{!-- x --}}` | `comment` |

A mustache is a block form when a sigil or `else` follows `{{`. Spaces and `~` can come between them. The grammar finds the block forms with a probe, so the brace types are final in the raw grammar and the pipeline has no retag pass.

A body ends at the first `}}` (or `}}}` for a triple stash) that is not in a quoted string or a template literal. The reclassifier sends each body to `@twinkleplop/javascript`. It sends each `<script>` or `<style>` body to JavaScript or CSS as one unit, with the mustaches as holes. Thus a string or a rule that holds a mustache stays whole. In a script, JavaScript sees a value mustache as an identifier and a block mustache as spaces, so `{{ a }} / 2` is a division, not a regex.

## Usage

```ts
import { language as handlebars } from "./twinkleplop/handlebars";

let highlight = handlebars();
let html = highlight("<h1>{{ $page.title }}</h1>");
```

The other exports follow the upstream packages. `tokenize(options?)` returns token data for a custom renderer. `grammar` is the compiled grammar, without embedding. `raw_grammar` is the grammar source. `reclassifiers` is the default pipeline, which you can extend.

## Differences from `@twinkleplop/html`

- Tag and attribute contexts accept mustaches, and HTML comments are a state instead of one `within` match, so a mustache inside a comment gets tokens.
- A close tag such as `</p>` inside a `<script>` or `<style>` body stays in the body. In `@twinkleplop/html` 0.1.7, the close probe looks ahead for any later `script>` and drops the text between.

## Known limitations

- A body is JavaScript, as in tempura. Handlebars path syntax such as `../parent`, `this/name`, `@index`, and `[segment]` gets JavaScript tokens, which can look wrong.
- Braces in a body are not counted. An object literal that ends just before the close, as in `{{#var a = {b: 1}}}`, closes the mustache early. tempura reads it the same way.
- A quoted string in a body stops at a line break. This keeps a stray quote from hiding the rest of the file. But a Handlebars string that spans lines and holds `}}` closes the mustache early.
- Every `<script>` body is JavaScript, also `<script type="text/x-handlebars-template">`.
- A raw block ends at the first `{{{{/`. The close name is not compared with the open name, and nested raw blocks are not supported.
- These come from `@twinkleplop/html`: an unquoted attribute value is an `attr_name`; `</script >` with a space before `>` does not close a script; `<script-x>` reads as a script; CDATA and entities get no tokens.
