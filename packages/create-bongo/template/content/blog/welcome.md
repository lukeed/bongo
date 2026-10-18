---
title: Welcome to bongo
date: 2026-01-08
summary: What bongo is, why it exists, and what makes it different from the crowded field of static site generators.
tags: ssg, bun, architecture
---

Every static site generator solves the same basic problem: turn source files into HTML. The question is always which tradeoffs you're willing to make — and for whom.

bongo started from a simple premise: what if you built an SSG today, with today's tooling, and optimised ruthlessly for developer experience and build speed? No compatibility shims, no pluggable renderers, no kitchen-sink feature sets. Just a fast, minimal pipeline that gets out of your way.

## The stack

bongo is built on three Rust-backed tools that make the build genuinely fast:

- **Bun** — the runtime. Native TypeScript support, a fast module resolver, and a built-in test runner.
- **rolldown** — JS and TS bundling. Orders of magnitude faster than Webpack, and designed as a Rollup-compatible drop-in.
- **LightningCSS** — CSS parsing, transformation, and minification. No PostCSS config needed.

The template engine is **tempura** — a tiny, fast Handlebars-compatible compiler. Layouts are `.hbs` files; content can be `.md`, `.hbs`, or plain `.html`.

## Why another SSG?

The honest answer: most SSGs are built for a specific ecosystem (Jekyll for Ruby, Hugo for Go, Next.js for React), and their abstractions reflect that origin. bongo is built specifically for the TypeScript/Bun world. The config is a plain TypeScript file. Plugins are just partial config objects. There's no magic directory structure, no framework-specific routing, no hidden lifecycle.

If you're building a blog, a docs site, or a marketing page, bongo should feel obvious to configure and fast to run.

## What's next

The immediate roadmap: incremental builds, a dev server with fast reload, and a proper `bun create bongo` scaffold. Follow along on [GitHub](https://github.com/lukeed/bongo).
