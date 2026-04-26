---
title: LightningCSS over PostCSS
date: 2026-02-20
summary: Why bongo chose LightningCSS over PostCSS for CSS processing, and how CSS modules fit into the story.
tags: lightningcss, performance, ssg
---

# LightningCSS Notes

[LightningCSS](https://lightningcss.dev) is a CSS parser, transformer, and bundler written in Rust. bongo uses it to process `assets/*.css` files. Here are some things worth knowing.

## What it does automatically

LightningCSS handles:

- **`@import` inlining** — imported CSS files are merged at build time
- **Vendor prefix injection** — adds `-webkit-`, `-moz-` etc. based on your browser targets
- **Syntax lowering** — modern CSS features are transpiled for older browsers
- **Minification** — dead code removal, property merging, shorthand expansion

You get all of this without a PostCSS config, a Babel plugin, or a webpack loader.

## Browser targets

Set targets in `bongo.config.ts`:

```ts
const config: Config = {
  $build: {
    target: 'defaults',
  },
};
```

Targets follow [browserslist](https://browsersl.ist) syntax. The default is the current browsers if unset.

## CSS modules

bongo supports CSS modules via a file naming convention. Name your file `*.module.css` and LightningCSS will scope class names locally. Import the module in your JavaScript to get the scoped names:

```ts
import styles from './button.module.css';
element.className = styles.primary;
```

## Custom properties and `@layer`

Custom properties (CSS variables) and `@layer` work out of the box. LightningCSS parses them correctly and minification preserves semantics.

```css
@layer base {
  :root { --accent: #b33; }
}

@layer components {
  .btn { background: var(--accent); }
}
```

## What it doesn't do

LightningCSS is not PostCSS. It doesn't run PostCSS plugins. If you rely on a specific PostCSS plugin for a feature LightningCSS doesn't support natively, you'll need to run PostCSS as a pre-step outside of bongo.
