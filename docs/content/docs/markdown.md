---
title: "@bongo/markdown"
summary: The Markdown loader plugin for bongo, its partial elements, its md4x options, and its syntax highlighters.
group: Plugins
order: 1
---

`@bongo/markdown` is the Markdown loader plugin for bongo, powered by [md4x](https://github.com/unjs/md4x).

## Install

```sh
bun add @bongo/markdown
```

## Usage

```ts [bongo.config.ts]
import { markdown } from '@bongo/markdown';

export default {
	plugins: [
		markdown(),
	],
};
```

The plugin registers an `.md` [loader](/docs/loaders/). It converts Markdown files to HTML content files, and exposes the frontmatter as page metadata:

```md [content/hello.md]
---
title: Hello
tags: docs, markdown
---

# Hello
```

See [Content](/docs/content/) and [Frontmatter](/docs/frontmatter/).

## Elements

A `<bongo:name>` element in Markdown prose calls the [partial](/docs/partials/) with that name. bongo leaves elements inside code blocks and inline code as written.

The element's attributes become the partial's arguments. bongo reads them as data, and never runs them as code:

```md
<bongo:card title="Hello" count=3 draft=false tags=[js, css] meta={ author: 'Luke' } featured />
```

- A quoted value, `"…"`, `'…'`, or `` `…` ``, is a string. Backslash escapes work as in JavaScript. `${…}` is plain text.
- A bare value is a number, `true`, `false`, `null`, or else text, so `src=img/a.png` is a string.
- `[…]` is a list and `{…}` is a map, written like JSON5: keys need no quotes, and a trailing comma is fine.
- A name with no value is `true`.

### Content between tags

An element can also wrap Markdown. The plugin renders the Markdown between the tags to HTML, and passes it to the partial as `$slot`:

```md
<bongo:card title="Hello">
Some *Markdown* text.
</bongo:card>
```

### Built-in elements

bongo's own elements, `<bongo:asset>`, `<bongo:image>`, `<bongo:style>`, `<bongo:script>`, and `<bongo:client>`, pass through untouched, for bongo to replace. See [Asset elements](/docs/templates/#asset-elements).

## Images

Images next to a post need no element. bongo gives `![alt](hero.jpg)` and `<img src="hero.jpg">` a `srcset` and their dimensions. Use `<bongo:image>` for a `<picture>` with more formats, or for your own `sizes`. See [Images](/docs/images/).

```md
<figure>
	<bongo:image src="./hero.jpg" alt="…" sizes="(min-width: 800px) 720px, 100vw" />
	<figcaption>…</figcaption>
</figure>
```

## Headings

The plugin gives each page its headings, in document order, as `$page.headings`. Each heading has a `level`, an `id`, its plain `text`, and its inner `html`, which keeps inline code and links. The headings are also in each entry of `$pages`, and in the `$pages` of [data modules](/docs/data-modules/). A table of contents in a layout:

```hbs
<ol>
{{#each $page.headings.filter(h => h.level === 2) as h}}
	<li><a href="#{{ h.id }}">{{{ h.html }}}</a></li>
{{/each}}
</ol>
```

The `id` is the anchor that `headingIds: true` gives the heading. Without that option, the page HTML has no anchors, so set `headingIds: true` when you link to headings. A line in a code block is not a heading. A partial in a heading is in `html`, but not in `text` or `id`.

## Options

`markdown()` accepts md4x HTML options. For example, `headingIds: true` gives each heading an `id` that links can target. Syntax highlighting is optional:

```ts [bongo.config.ts]
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

Install the highlighter package that you want to use:

```sh
bun add shiki
bun add sugar-high
```

Then import from `@bongo/markdown/highlight`:

```ts
import { shiki, sugarhigh } from '@bongo/markdown/highlight';
```

### Shiki

`shiki(options)` loads Shiki with the requested theme and languages. A fence in a language that is not in `langs` renders as escaped plain text in the same theme. Set `unknown: 'throw'` to fail the build instead. A fence with no language keeps the plain md4x block.

### Sugar High

`sugarhigh()` loads Sugar High, version 2 or later. It highlights fenced code in a language that Sugar High knows, such as `ts`, `py`, or `bash`. Other code blocks stay plain. Sugar High colors tokens with `--sh-*` CSS variables, so add a [theme](https://github.com/huozhi/sugar-high#styling) to your styles.

### Your own highlighter

A highlighter can also be your own function. md4x calls it once for each code block, with the code and the block details, such as `lang`. It must return synchronously: either the HTML for the whole block, `<pre>` included, or `undefined` to keep the plain block.

## Twinkleplop

[Twinkleplop](https://twinkleplop.pngwn.at) writes CSS classes, not inline colors, so a theme stylesheet gives the colors. Install its markdown core, one package for each language that you use, and a theme:

```sh
bun add @twinkleplop/markdown-core @twinkleplop/typescript @twinkleplop/bash @twinkleplop/theme-github
```

Then give your languages to `twinkleplop()` from `@bongo/markdown/twinkleplop`:

```ts [bongo.config.ts]
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

### Languages

`languages` maps a fence name to a highlighter, or to the name of another entry, such as `js: 'typescript'`. Common aliases resolve to the languages that you register: `typescript` also covers `ts`, `mts`, and `cts` fences, and `bash` covers `sh`, `shell`, and `zsh`. Your own entries take priority.

A fence in a language that is not in `languages` renders as escaped plain text. Set `on_unknown_language: 'throw'` to fail the build instead. A fence with no language keeps the md4x `<pre><code>` output, unless you set `default_language`.

### Other options

The other options, such as `default_language`, `line_numbers`, and `render`, are the same as in the [twinkleplop markdown plugins](https://twinkleplop.pngwn.at/docs/markdown). Fences can mark lines with `{1,3-4}`, add a title with `[app.ts]`, and turn on line numbers with `ts:line-numbers`.

### Theme

Import the theme in your CSS by its package name. See [Packages in @import](/docs/css/#packages-in-import).

```css [assets/app.css]
@import "@twinkleplop/theme-github";

.twinkleplop {
	background: var(--twp-background);
}
```

```hbs
<bongo:style src="app.css"></bongo:style>
```

The theme has light and dark colors. A `dark` class on an ancestor, such as `<html class="dark">`, selects the dark colors. To use one set only, import `@twinkleplop/theme-github/light` or `@twinkleplop/theme-github/dark`.

## Code blocks

`fence` wraps the HTML of each code block. Use it to add a title bar, a language label, or a copy button. It works with every highlighter, and without one:

```ts [bongo.config.ts]
import { markdown } from '@bongo/markdown';
import type { Fence } from '@bongo/markdown';

const escape = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

const fence: Fence = (html, block) => {
	let title = escape(block.filename ?? block.lang);
	return `<figure class="code"><figcaption>${title}</figcaption>${html}</figure>`;
};

export default {
	plugins: [markdown({ fence })],
};
```

- `html` is the output of the [highlighter](#highlighters). When there is no highlighter, or when the highlighter returns `undefined`, such as for an unknown language, it is the md4x `<pre><code>` block with the code escaped.
- `block` is the block that the highlighter gets, typed as `Fence.Block`: `lang` (an empty string when the block has no language), `filename` from `[app.ts]`, and `highlights` from `{1,3-4}`. It also has `code`, the text of the block, with its last line break.
- Every code block goes through `fence`: fences with a language, fences without one, and indented code blocks.
- When you set `fence`, the highlighter does not get `filename`. Thus a highlighter that prints its own title, such as [twinkleplop](#twinkleplop) with `[app.ts]`, does not add a second one. Print the title in `fence`.
- `lang` and `filename` are text from your Markdown, as you wrote it. Escape them before you put them in HTML.
- `fence` runs during the render, so it must return a string, not a promise.
