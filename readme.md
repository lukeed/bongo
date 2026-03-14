# bongo

> A static site generator with partial hydration, built on Rolldown

## Overview

**bongo** is a monorepo containing a static site generator (SSG) and associated tooling. It processes content files (Markdown, HTML, Handlebars) through a loader pipeline, applies layouts/partials via a [tempura](https://github.com/lukeed/tempura)-based template engine, and bundles client-side assets using [Rolldown](https://rolldown.rs).

## Setup

```sh
# install
$ pnpm install

# build all packages
$ pnpm build

# type-check
$ pnpm test
```

> **Important:** Requires Node 24+

## Project Structure

```
├── build/              # Package build system (rolldown)
│   ├── index.js        # Entry – builds all packages in parallel
│   ├── plugins.js      # Rolldown plugins (resolve, dynamic imports)
│   └── util.js         # Build logic using rolldown API
│
├── packages/
│   ├── bongo/          # Core SSG package (@lukeed/bongo)
│   │   ├── bin.js      # CLI entry (bongo build | bongo dev)
│   │   ├── index.d.ts  # Public type definitions
│   │   └── src/
│   │       ├── index.ts   # Exports: build, dev, define
│   │       ├── build.ts   # Static site build pipeline
│   │       ├── dev.ts     # Dev server with live reload
│   │       └── utils/
│   │           ├── argv.ts     # CLI argument normalization
│   │           ├── config.ts   # Config file discovery & loading
│   │           ├── bundler.ts   # Asset bundling via Rolldown JS API
│   │           ├── fs.ts       # File system utilities (read, write, watch)
│   │           ├── http.ts     # Dev server (sirv + SSE reload)
│   │           ├── index.ts    # debounce/throttle helpers
│   │           ├── log.ts      # Debug logging
│   │           ├── views.ts    # Template/layout collection & asset blocks
│   │           └── tempura/    # Embedded tempura template engine
│   │
│   ├── plugin.markdown/   # Markdown loader plugin (@bongo/markdown)
│   │   └── src/index.ts   # markdown-it based .md → .html loader
│   │
│   └── create-bongo/      # Scaffolding CLI (create-bongo)
│       ├── bin.js
│       └── template/      # Project template files
│
├── demo123/            # Demo site using bongo
├── build-old.js        # Legacy esbuild build (archived)
├── render.js           # Legacy render prototype (archived)
└── runtime.js          # Client-side hydration strategies (idle, visible, interact)
```

## How It Works

### Build Pipeline

When you run `bongo build`:

1. **Config loading** (`utils/config.ts`): Finds `bongo.config.{ts,mjs,cjs,js}` by traversing upward from `cwd`. TypeScript configs are transpiled on-the-fly using rolldown's OXC transform.

2. **View collection** (`utils/views.ts`): Scans `layouts/` and `partials/` directories. Handlebars files (`.hbs`) are compiled with tempura. JS/TS partials are loaded as modules. Template blocks (`{{#script ...}}`, `{{#style ...}}`, `{{#partial ...}}`) are registered here.

3. **Content processing** (`build.ts`): Iterates over `content/` files:
   - Files matching a registered **loader** (by extension) are piped through the loader chain
   - Each loader transforms the content and may change the file extension, triggering the next loader
   - Once content reaches `.html`/`.hbs`, it's wrapped in the matching layout template
   - Layout lookup follows a priority order: section-specific → `single.hbs` → `index.hbs` → `html.hbs`

4. **Asset bundling** (`utils/bundler.ts`): Scripts and styles referenced via `{{#script}}` / `{{#style}}` blocks are bundled using Rolldown's JS API. Assets are grouped by format+target to enable code splitting. Output filenames include content hashes.

### Loader System

Loaders transform content files by file extension. They are registered via `$assets` in the config:

```js
// bongo.config.mjs
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

Loaders are chained: a `.md` file produces `.md.html`, then the `.html` extension stops the chain and enters the template pipeline. The `@bongo/markdown` plugin provides a production-ready Markdown loader with frontmatter parsing and `<bongo:partial>` tag support.

**Loader utilities** passed as the third argument:
- `utils.decode(uint8array)` — convert buffer to string
- `utils.render(partialName, args)` — invoke a registered partial
- `utils.frontmatter(content)` — parse YAML-like frontmatter (`---` delimited)

### Config File

```js
// bongo.config.mjs
import { markdown } from '@bongo/markdown';

export const $site = {
  title: 'My Site',
  url: 'https://example.com/',
  lang: 'en',
};

export const $assets = {
  html(filename, content) {
    return { filename, content };
  }
};

export const plugins = [
  markdown()
];
```

**Config fields:**
- `$site` — Site metadata available in all templates as `{{$site.title}}`
- `$utils` — Helper functions available in templates (`truncate`, `countwords`, `url.abs`, `date.format`)
- `$assets` — Loader map keyed by file extension
- `$partials` — Programmatic partials (functions)
- `plugins` — Array of partial config objects, merged in order

### Templates

Templates use [tempura](https://github.com/lukeed/tempura) syntax (Handlebars-like):

```hbs
{{! comment }}
{{ $page.title }}           {{! escaped output }}
{{{ $page.content }}}       {{! raw/unescaped output }}
{{#if $page.params.draft }} {{! conditionals }}
{{#each items as (item, i)}}{{! loops }}
{{#partial src="header" }}  {{! include a partial }}
{{#script src="main.ts" format="esm" async=true }}
{{#style src="app.css" preload=true }}
```

**Template variables:** `$site`, `$page`, `$assets`, `$utils`

### Dev Server

`bongo dev` runs the full build, then starts a local server with SSE-based live reload. File changes in `assets/`, `layouts/`, `partials/`, or `content/` trigger a full rebuild and browser refresh.

## Package Build System

The `build/` directory builds the publishable packages using [rolldown](https://rolldown.rs) (the Rust-based Rollup successor, bundled with Vite 8). Each package's `src/index.ts` is compiled to a single CJS `index.js` with minification. TypeScript is handled natively by rolldown — no separate transpilation step.
