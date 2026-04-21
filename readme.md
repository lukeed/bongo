# bongo

> A static site generator built on Rolldown and LightningCSS

## Overview

**bongo** is a monorepo containing a static site generator (SSG) and associated tooling. It processes content files (Markdown, HTML, Handlebars) through a loader pipeline, applies layouts/partials via a [tempura](https://github.com/lukeed/tempura)-based template engine, and bundles client-side assets using [Rolldown](https://rolldown.rs) (JS) and [LightningCSS](https://lightningcss.dev) (CSS).

## Toolchain

bun is the primary development tool. Node 24+ is still supported at runtime (bongo auto-detects the runtime and adjusts its config loader accordingly), but all workspace commands use bun.

## Setup

```sh
# install
bun install

# build all packages
bun run build

# type-check + tests
bun test
```

## Project Structure

```
├── build/              # Package build system (rolldown)
│   ├── index.ts        # Entry – builds all packages in parallel
│   ├── plugins.js      # Rolldown plugins (resolve, dynamic imports)
│   └── util.js         # Build logic using rolldown API
│
├── packages/
│   ├── bongo/          # Core SSG package (@lukeed/bongo)
│   │   ├── bin.js      # CLI entry (bongo build | bongo dev)
│   │   ├── index.d.ts  # Public type definitions
│   │   └── src/
│   │       ├── index.ts    # Exports: build, dev, define
│   │       ├── build.ts    # Static site build pipeline
│   │       ├── dev.ts      # Dev server with live reload
│   │       └── utils/
│   │           ├── argv.ts      # CLI argument normalization
│   │           ├── config.ts    # Config file discovery & loading
│   │           ├── bundler.ts   # Two-pass asset bundling (Rolldown + LightningCSS)
│   │           ├── css.ts       # LightningCSS wrapper
│   │           ├── fs.ts        # File system utilities (read, write, watch)
│   │           ├── http.ts      # Dev server (sirv + SSE reload)
│   │           ├── index.ts     # debounce/throttle helpers
│   │           ├── log.ts       # Debug logging
│   │           ├── templates.ts # Template/layout collection & asset blocks
│   │           └── tempura/     # Embedded tempura template engine
│   │
│   ├── plugin.markdown/   # Markdown loader plugin (@bongo/markdown)
│   │   └── src/index.ts   # markdown-it based .md → .html loader
│   │
│   └── create-bongo/      # Scaffolding CLI (create-bongo)
│       ├── bin.js
│       └── template/      # Project template files
│
└── example/            # Demo site using bongo
```

## How It Works

### Build Pipeline

When you run `bongo build`:

1. **Config load** (`utils/config.ts`): Finds `bongo.config.{ts,mjs,cjs,js}` by traversing upward from `cwd`. Bun and Deno import `.ts` natively. On Node, bongo bundles the config through rolldown to a temp `.mjs` and dynamic-imports it — no separate transpile step required.

2. **Template collection** (`utils/templates.ts`): Scans `layouts/` and `partials/` directories. Handlebars files (`.hbs`) are compiled with tempura. JS/TS partials are loaded as modules. The `style`, `link`, `script`, and `partial` template blocks are registered here.

3. **Pass 1 — Render**: For each content file, run it through any registered loaders, then apply the matching layout template. During render, `style`/`link`/`script` blocks call `bundler.register(entry, cfg)` and emit opaque placeholder tokens into the HTML output. Pages are collected in memory.

4. **Flush**: `bundler.flush({ outDir })` runs all bundle groups in parallel. JS groups go through rolldown with code splitting and content-hashed filenames. CSS groups go through LightningCSS (`@import` bundling, autoprefixing, nesting, optional minification). Output filenames include content hashes.

5. **Pass 2 — Substitute** (`templates.substitute()`): For each rendered page, placeholder tokens are rewritten:
   - External assets: `{publicPath}{hashed-filename}` in `src`/`href` attributes.
   - Inline assets: built file contents spliced directly into the element.

6. **Write**: all pages written to `public/` in the project root.

### Loader System

Loaders transform content files by file extension. Register them via `$assets` in the config:

```ts
// bongo.config.ts
export const $assets = {
  md(filename, content, utils) {
    // transform .md → .html
    return {
      filename: filename + '.html',
      content: renderedHtml,
      metadata: { title: '...' }
    };
  }
};
```

Loaders are chained by extension. A `.md` file produces `.md.html`, the `.html` extension stops the chain and enters the template pipeline. The `@bongo/markdown` plugin provides a production-ready Markdown loader with frontmatter parsing.

**Loader utilities** (third argument):
- `utils.decode(uint8array)` — convert buffer to string
- `utils.render(partialName, args)` — invoke a registered partial
- `utils.frontmatter(content)` — parse YAML-like frontmatter (`---` delimited)

### Config File

```ts
// bongo.config.ts
import { markdown } from '@bongo/markdown';

export const $site = {
  title: 'My Site',
  url: 'https://example.com/',  // also drives publicPath
  lang: 'en',
};

export const $assets = {
  html(filename, content) {
    return { filename, content };
  }
};

export const $utils = {
  excerpt(text: string, len: number) {
    return text.slice(0, len);
  }
};

export const $partials = {
  // programmatic partials (functions)
};

export const plugins = [
  markdown()
];
```

**Config fields:**
- `$site` — site metadata; available in all templates as `{{$site.title}}`. The `url` field drives `publicPath` (see below).
- `$assets` — loader map keyed by file extension
- `$utils` — helper functions available in templates
- `$partials` — programmatic partials (functions)
- `plugins` — array of partial config objects, merged in order

### publicPath

The `publicPath` prefix applied to all external asset URLs is derived automatically from `$site.url`:

- Root-served site (`https://example.com`) → `publicPath = /`
- Subpath-served site (`https://example.com/blog/`) → `publicPath = /blog/`

No manual configuration needed.

### Templates

Templates use [tempura](https://github.com/lukeed/tempura) syntax (Handlebars-like). Asset references use standard HTML tags — bongo recognises them during render:

```hbs
{{! layouts/html.hbs }}
<!doctype html>
<html lang="{{$site.lang}}">
<head>
  <meta charset="utf-8"/>
  <title>{{ $page.title }}</title>

  {{! Inline CSS: <style src> always splices the built file into a <style> block }}
  {{#style src="app.css"}}

  {{! External CSS: <link rel=stylesheet> rewrites href to hashed public URL }}
  {{#link rel="stylesheet" href="print.css"}}
</head>
<body>
  {{{ $page.content }}}

  {{! External JS (default): src rewritten to hashed public URL }}
  {{#script src="main.ts"}}

  {{! Async external JS }}
  {{#script src="analytics.ts" async=true}}

  {{! Inline JS: file contents spliced into the <script> element }}
  {{#script src="boot.ts" inline=true}}
</body>
</html>
```

**Asset block rules:**
- `{{#style src="…"}}` → always inline (built CSS spliced into `<style>…</style>`).
- `{{#link rel="stylesheet" href="…"}}` → always external (bongo rewrites `href` to hashed URL). Other `rel` values pass through unchanged.
- `{{#script src="…"}}` → external by default (bongo rewrites `src` to hashed URL). Add `inline=true` to splice contents.

**Supported script attributes:** `async`, `defer`, `format="esm"|"cjs"`, `target="…"`, `inline`.

**Partial includes:**

```hbs
{{#partial src="header" }}
{{#partial src="card" title="Hello" }}
```

**Template variables:**

- `$site` — global site config (`url`, `title`, `lang`, `menu`, `description`).
- `$page` — the current page being rendered. Fields: `path`, `url`, `title`, `summary`, `params` (frontmatter), `section` (directory prefix), `tags` (parsed from `params.tags`), `content` (pre-layout rendered body), `scripts`, `styles`.
- `$pages` — every page in the build, sorted by path ascending. Each entry has `path`, `url`, `title`, `summary`, `section`, `tags`, `params`.
- `$section` — same shape as `$pages`, scoped to the current page's section directory (includes the section's own `index` page if present).
- `$tags` — an array of `{ tag, pages }` entries. Iterate with `{{#each $tags as (entry)}}{{#each entry.pages as (p)}}…{{/each}}{{/each}}`.
- `$assets` — loader map configured via `bongo.config.ts`.
- `$utils` — helpers (`truncate`, `countwords`, `url.abs`, `date.format`).

Content files ending in `.hbs` are themselves tempura-compiled before layout render, with `$site`, `$assets`, `$utils`, and `params` in scope (no `$page`/`$pages`/`$section`/`$tags` — those belong to the layout pass).

### CSS

All CSS is handled by [LightningCSS](https://lightningcss.dev): `@import` bundling, autoprefixing, nesting, and optional minification. No SCSS, LESS, or PostCSS support.

`.module.css` files automatically get CSS modules enabled. Non-module files can opt in explicitly when registering the entry.

### Dev Server

`bongo dev` runs the full build, then starts a local HTTP server with an SSE reload channel. File changes in `assets/`, `layouts/`, `partials/`, or `content/` trigger a full rebuild and push one of the following SSE messages to the browser:

| Message | Meaning |
|---|---|
| `{ type: 'reload' }` | Successful rebuild — browser reloads the page |
| `{ type: 'error', errors }` | Build failed — full-viewport error overlay mounted |
| `{ type: 'error-clear' }` | Next successful build — overlay unmounted, then reload |

The `hmr` message type exists in the type union for forward compatibility. Rolldown's HMR client transport is not yet stable (as of 1.0-rc.9), so all file changes trigger a full reload today.

## Package Build System

The `build/` directory builds the publishable packages using [rolldown](https://rolldown.rs). Each package's `src/index.ts` is compiled to a single CJS `index.js` with minification. TypeScript is handled natively by rolldown — no separate transpilation step.
