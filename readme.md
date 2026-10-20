<div align="center">
  <a href="https://bongo.build">
    <img src="./docs/assets/img/og.png" alt="bongo — static sites with a good beat" width="640" />
  </a>
  <h3>Hit it.</h3>
  <p>
    <a href="https://bongo.build">Docs</a> ·
    <a href="https://bongo.build/quick-start/">Quick start</a> ·
    <a href="https://bongo.build/config/">Config</a> ·
    <a href="https://bongo.build/cli/">CLI</a>
  </p>
</div>

## What is bongo?

bongo is a static site generator. It turns Markdown, templates, and assets into fast static HTML. Rolldown bundles your scripts, LightningCSS bundles your styles, and [tempura](https://github.com/lukeed/tempura) renders your templates.

You write one config file and put your files in a small set of folders. bongo writes plain HTML, CSS, and JS to `public/`.

```
my-site/
├── assets/          scripts, styles, fonts
├── content/         pages: .md, .hbs, .html
├── data/            JSON, YAML, modules → $data
├── layouts/         html.hbs wraps each page
├── partials/        reusable template pieces
└── bongo.config.ts  site, helpers, plugins
```

## Why bongo?

- **Fast**: 10,000 Markdown pages build in 2.4 s. A repeat build renders only the pages that a change reaches. See [`bench/results.md`](./bench/results.md).
- **Modern tools**: Rolldown for scripts, LightningCSS for styles, with bundling, nesting, autoprefixing, and CSS modules.
- **Images**: resize, convert, and get a `srcset`, `width`, and `height` for free. Draw a partial as an image, such as an Open Graph card for each page.
- **Content**: typed frontmatter, drafts, tags, sections, translations, sitemaps, feeds, and search indexes.
- **Dev server**: live reload and an error overlay.
- **Client runtime**: optional client-side navigation, prefetch, and view transitions.
- **Runs anywhere**: Bun 1.4+, Deno, and Node 24+.

## Quick start

Create a site:

```sh
bun create bongo my-site
cd my-site
bun install
```

Start the dev server at `http://localhost:3000/`:

```sh
bun run dev
```

Build the site into `public/`:

```sh
bun run build
```

> [!TIP]
> Image processing needs the Bun runtime. To resize images, run `bun --bun run dev` and `bun --bun run build`.

To add bongo to an existing project, see [Add bongo by hand](https://bongo.build/quick-start/#add-bongo-by-hand).

## Docs

Everything else is at **[bongo.build](https://bongo.build)**:

- [Introduction](https://bongo.build/intro/)
- [Project layout](https://bongo.build/project/)
- [Templates](https://bongo.build/templates/)
- [Images](https://bongo.build/images/)
- [CSS](https://bongo.build/css/)

## Packages

| Package | Description |
| --- | --- |
| [`@bongo/bongo`](./packages/bongo) | The core static site generator and the optional browser runtime. Install it as `bongo@npm:@bongo/bongo`. |
| [`@bongo/markdown`](./packages/plugin.markdown) | Markdown loader plugin. |
| [`@bongo/feed`](./packages/plugin.feed) | RSS and Atom feed plugin. |
| [`create-bongo`](./packages/create-bongo) | Project scaffolding CLI. |

## Contributing

Bun 1.4+ is the primary development tool. Node 24+ is still supported at runtime, but workspace commands use Bun.

```sh
bun install
bun test
bun run build
```

Run the example site, or the docs site:

```sh
bun run example dev
bun run docs dev
```

The package build uses Rolldown and writes the publishable package files in place.

## License

MIT © [Luke Edwards](https://lukeed.com)
