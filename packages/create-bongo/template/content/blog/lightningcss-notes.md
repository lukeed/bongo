---
title: LightningCSS over PostCSS
date: 2026-02-20
summary: Why bongo uses LightningCSS for CSS, and what it does for each stylesheet.
tags: lightningcss, performance, ssg
---

[LightningCSS](https://lightningcss.dev) is a CSS parser, transformer, and bundler written in Rust. bongo builds each stylesheet with it. Here are some things worth knowing.

## Add a stylesheet

Add a stylesheet to a layout with `<bongo:style>`. The `src` is relative to `assets/`:

```hbs
<bongo:style src="style.css"></bongo:style>
```

bongo writes the built file with a content hash in its name, and links it. With `inline`, it puts the CSS in a `<style>` element instead.

## What it does for you

- **`@import` bundling**: it puts each imported file in the output. An `@import` can also name a package in `node_modules`.
- **Prefixes**: it adds `-webkit-` and other prefixes for your browser target.
- **Syntax lowering**: it turns newer syntax, such as nesting, into syntax that older browsers read.
- **Minification**: with `--minify`, it minifies every stylesheet.

You need no PostCSS config, no Babel plugin, and no webpack loader.

## Browser targets

Set the target in `bongo.config.ts`:

```ts
import type { Config } from 'bongo';

export default {
  $build: {
    target: ['chrome >= 120', 'safari >= 17', 'firefox >= 121'],
  },
} satisfies Config;
```

The target is a [browserslist](https://browsersl.ist) query, or a list of queries. The default is `'defaults'`.

## CSS modules

A file named `*.module.css` is a CSS module: LightningCSS gives its class names a scope, so they do not clash with other stylesheets. To use a `.module.css` file as plain CSS, add `global` to its `<bongo:style>`.

## Custom properties and `@layer`

Custom properties and `@layer` work as they are. LightningCSS parses them, and minification keeps what they mean:

```css
@layer base {
  :root { --accent: #b33; }
}

@layer components {
  .btn { background: var(--accent); }
}
```

## What it does not do

LightningCSS is not PostCSS, and it does not run PostCSS plugins. If you need a PostCSS plugin for a feature that LightningCSS does not have, run PostCSS as a step before bongo.
