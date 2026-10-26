---
title: Welcome to bongo
date: 2026-01-08
summary: What bongo is, why it exists, and how it differs from other static site generators.
tags: ssg, bun, architecture
---

Every static site generator solves the same problem: it turns source files into HTML. The real question is which tradeoffs it makes, and for whom.

bongo started from a simple premise: build an SSG with today's tools, and make it fast and easy to use. It has no compatibility shims, no pluggable renderers, and no long list of features you do not need. It is a small pipeline that stays out of your way.

## The stack

- **Rolldown** bundles JavaScript and TypeScript. It is written in Rust, and it is compatible with the Rollup API.
- **LightningCSS** bundles, prefixes, and minifies CSS, also in Rust. You need no PostCSS config.
- **tempura** compiles the templates. Its syntax is like Handlebars, and each value is a JavaScript expression. Layouts and partials are `.hbs` files. Content can be `.md`, `.hbs`, or plain `.html`.

bongo runs in Bun, Deno, and Node. Bun is the main development tool, and image processing needs it.

## Why another SSG?

Most SSGs come from one ecosystem, such as Jekyll from Ruby, Hugo from Go, or Next.js from React, and their abstractions show it. bongo is made for TypeScript. The config is a plain TypeScript file. A plugin is a partial config object. The folders are few and plain: `content/`, `layouts/`, `partials/`, `assets/`, and `data/`.

If you build a blog, a docs site, or a marketing page, bongo should be easy to configure and fast to run.

## Where to go next

The docs at [bongo.build](https://bongo.build) cover every part of bongo. The source is on [GitHub](https://github.com/lukeed/bongo).
