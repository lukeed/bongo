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

`sugarhigh()` loads Sugar High, version 2 or later. It highlights fenced code in a language that Sugar High knows, such as `ts`, `py`, or `bash`. Other code blocks stay plain. Sugar High colors tokens with `--sh-*` CSS variables, so add a [theme](https://github.com/huozhi/sugar-high#styling) to your styles.
