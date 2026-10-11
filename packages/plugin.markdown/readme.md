# @bongo/markdown

Markdown loader plugin for bongo, powered by [md4x](https://github.com/unjs/md4x).

## Install

```sh
bun add @bongo/markdown
```

## Usage

```ts
import { markdown } from '@bongo/markdown';

export default {
	plugins: [
		markdown(),
	],
};
```

The plugin registers an `.md` loader. Markdown files are converted to HTML content files and frontmatter is exposed as page metadata.

```md
---
title: Hello
tags: docs, markdown
---

# Hello
```

## Elements

`<bongo:name>` elements in Markdown prose call the partial with that name. Elements inside code blocks and inline code are left as written.

The element's attributes become the partial's arguments. bongo reads them as data and never runs them as code:

```md
<bongo:card title="Hello" count=3 draft=false tags=[js, css] meta={ author: 'Luke' } featured />
```

- A quoted value, `"…"`, `'…'`, or `` `…` ``, is a string. Backslash escapes work as in JavaScript. `${…}` is plain text.
- A bare value is a number, `true`, `false`, `null`, or else text, so `src=img/a.png` is a string.
- `[…]` is a list and `{…}` is a map, written like JSON5: keys need no quotes, and a trailing comma is fine.
- A name with no value is `true`.

bongo's own elements, `<bongo:asset>`, `<bongo:image>`, `<bongo:style>`, `<bongo:script>`, and `<bongo:client>`, are passed through untouched for bongo to replace.

Images next to a post need no element: bongo gives `![alt](hero.jpg)` and `<img src="hero.jpg">` a `srcset` and their dimensions. Use `<bongo:image>` for a `<picture>` with more formats, or for your own `sizes`. See [Images](../bongo/readme.md#images).

```md
<figure>
	<bongo:image src="./hero.jpg" alt="…" sizes="(min-width: 800px) 720px, 100vw" />
	<figcaption>…</figcaption>
</figure>
```

## Options

`markdown()` accepts md4x HTML options. Syntax highlighting is optional:

```ts
import { markdown } from '@bongo/markdown';
import { shiki } from '@bongo/markdown/highlight';

export default {
	plugins: [
		markdown({
			highlighter: shiki({
				theme: 'github-dark',
				langs: ['js', 'ts', 'css', 'bash'],
			}),
		}),
	],
};
```

## Highlighters

Install the highlighter package you want to use:

```sh
bun add shiki
bun add sugar-high
```

Then import from `@bongo/markdown/highlight`:

```ts
import { shiki, sugarhigh } from '@bongo/markdown/highlight';
```

`shiki(options)` loads Shiki with the requested theme and languages.

`sugarhigh()` loads Sugar High.

### Twinkleplop

[Twinkleplop](https://twinkleplop.pngwn.at) writes CSS classes, not inline colors, so a theme stylesheet gives the colors. Install its markdown core, one package for each language you use, and a theme:

```sh
bun add @twinkleplop/markdown-core @twinkleplop/typescript @twinkleplop/bash @twinkleplop/theme-github
```

Then give your languages to `twinkleplop()` from `@bongo/markdown/twinkleplop`:

```ts
import { markdown } from '@bongo/markdown';
import { twinkleplop } from '@bongo/markdown/twinkleplop';
import { language as bash } from '@twinkleplop/bash';
import { language as typescript } from '@twinkleplop/typescript';

export default {
	plugins: [
		markdown({
			highlighter: twinkleplop({
				languages: {
					typescript: typescript(),
					bash: bash(),
				},
			}),
		}),
	],
};
```

`languages` maps a fence name to a highlighter, or to the name of another entry, such as `js: 'typescript'`. Common aliases resolve to the languages you register: `typescript` also covers `ts`, `mts`, and `cts` fences, and `bash` covers `sh`, `shell`, and `zsh`. Your own entries take priority.

A fence in a language that is not in `languages` renders as escaped plain text. Set `on_unknown_language: 'throw'` to fail the build instead. A fence with no language keeps the md4x `<pre><code>` output, unless you set `default_language`.

The other options, such as `default_language`, `line_numbers`, and `render`, are the same as in the [twinkleplop markdown plugins](https://twinkleplop.pngwn.at/docs/markdown). Fences can mark lines with `{1,3-4}`, add a title with `[app.ts]`, and turn on line numbers with `ts:line-numbers`.

Import the theme in your CSS. An `@import` path is relative to the CSS file, so point it at the theme in `node_modules`:

```css
/* assets/app.css */
@import "../node_modules/@twinkleplop/theme-github/dist/index.css";

.twinkleplop {
	background: var(--twp-background);
}
```

```hbs
<bongo:style src="app.css"></bongo:style>
```

The theme has light and dark colors. A `dark` class on an ancestor, such as `<html class="dark">`, selects the dark colors. To use one set only, import `dist/light.css` or `dist/dark.css`.
