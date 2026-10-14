---
title: Introduction
summary: What bongo is, what it does, which packages it ships, and which runtimes it supports.
group: Start
order: 1
---

bongo is a static site generator. It bundles scripts with Rolldown, builds styles with LightningCSS, renders templates with tempura, and reads Markdown through the `@bongo/markdown` plugin.

## What bongo does

bongo passes your content files through a loader pipeline. It applies layouts and partials with a template engine based on [tempura](https://github.com/lukeed/tempura). It bundles client assets: Rolldown builds the JavaScript, and LightningCSS builds the CSS. Then it writes the site to `public/`.

You write one config file, `bongo.config.ts`, and put your files in a small set of folders. [Project layout](/docs/project-layout/) describes each folder and each step of a build.

## Features

- **Content**: Markdown, HTML, and `.hbs` files become pages. Their paths set their URLs. See [Content](/docs/content/).
- **Frontmatter**: a typed YAML subset at the top of each file. See [Frontmatter](/docs/frontmatter/).
- **Templates**: layouts and partials with `$site`, `$page`, `$pages`, `$section`, `$tags`, and `$data`. See [Templates](/docs/templates/) and [Partials](/docs/partials/).
- **Data**: JSON, YAML, and module files in `data/` are available in every template. See [Data](/docs/data/).
- **Assets**: `<bongo:script>`, `<bongo:style>`, and `<bongo:asset>` elements bundle and publish files under content-hashed names. See [Asset elements](/docs/templates/#asset-elements).
- **Images**: bongo resizes and converts images, and gives them a `srcset`, a `width`, and a `height`. See [Images](/docs/images/).
- **Rendered images**: draw a partial as an image, such as a social card for each page. See [Rendered images](/docs/rendered-images/).
- **CSS**: bundling, autoprefixing, nesting, CSS modules, and packages in `@import`. See [CSS](/docs/css/).
- **Output files**: a sitemap, a `robots.txt`, or a feed from one `.hbs` file. See [Output files](/docs/output-files/).
- **Data modules**: JSON files from a TypeScript or JavaScript module, such as a search index. See [Data modules](/docs/data-modules/).
- **Client runtime**: optional client-side navigation, prefetch, and view transitions. See [Client runtime](/docs/client-runtime/) and [View transitions](/docs/view-transitions/).
- **Dev server**: live reload and an error overlay. See [Dev server](/docs/dev-server/).
- **Hooks**: change each page before bongo writes it. See [Hooks](/docs/hooks/).

## Packages

| Package | Description |
| --- | --- |
| `bongo` | The core static site generator and the optional browser runtime. |
| `@bongo/markdown` | Markdown loader plugin. See [@bongo/markdown](/docs/markdown/). |
| `@bongo/feed` | RSS and Atom feed plugin. See [@bongo/feed](/docs/feed/). |
| `create-bongo` | Project scaffolding CLI. See [Quick start](/docs/quick-start/). |

The core package is published as `@lukeed/bongo`. Install it and import it through the `bongo` alias:

```sh
bun add bongo@npm:@lukeed/bongo
```

All examples in these docs use the name `bongo`.

## Runtimes

bongo runs in Bun, Deno, and Node 24 or later. Image processing uses `Bun.Image`, so it needs the Bun runtime. Without Bun, bongo copies each image as it is. See [Images](/docs/images/#bun-runtime). [Rendered images](/docs/rendered-images/) work in every runtime as SVG and PNG, and need Bun for JPEG and WebP.

## Work on bongo

The bongo repository holds the static site generator, its Markdown and feed plugins, the project scaffolder, and an example site for development. Bun is the primary development tool. Node 24 or later is still supported at runtime, but the workspace commands use Bun:

```sh
bun install
bun test
bun run build
```

To run the example site:

```sh
bun run example dev
```

The package build uses Rolldown and writes the publishable package files in place.

## Next steps

- [Quick start](/docs/quick-start/): create a site and run it.
- [Project layout](/docs/project-layout/): learn what each folder does.
- [Config](/docs/config/): see every config field.
