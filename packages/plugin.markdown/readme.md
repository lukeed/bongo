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
