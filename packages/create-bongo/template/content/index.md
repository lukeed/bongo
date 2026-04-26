---
title: Home
summary: bongo is a fast, minimal static site generator built for the Bun era.
---

# bongo

**bongo** is a small, opinionated static site generator. It uses [Handlebars-style](https://tempura.js.org) templates, a two-pass render pipeline, and [rolldown](https://rolldown.rs) + [LightningCSS](https://lightningcss.dev) for asset bundling.

Everything is TypeScript. The config is a plain `.ts` file. There's no magic directory structure, no framework lock-in, no hidden lifecycle.

## What it does

- Compiles `.hbs`, `.md`, and `.html` content into pages
- Bundles TypeScript and CSS through rolldown and LightningCSS, with content-hashed output
- Provides a layout chain: section-specific layouts wrap content before the root HTML layout
- Exposes `$site`, `$page`, `$pages`, `$section`, and `$tags` to layouts for building indexes and archives

## Getting started

```bash
bun create bongo my-site
cd my-site
bun run build
```

## Explore

- [Blog](/blog/) — dev log posts on building bongo
- [About](/about/) — design goals and architecture overview
- [Contact](/contact/) — how to reach the project
