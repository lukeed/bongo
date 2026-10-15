---
title: Introduction
summary: What bongo is, what it does, which packages it ships, and which runtimes it supports.
group: Start
order: 1
---

bongo is a static site generator. It bundles scripts with Rolldown, builds styles with LightningCSS, renders templates with tempura, and reads Markdown through the `@bongo/markdown` plugin.

## What bongo does

bongo passes your content files through a loader pipeline. It applies layouts and partials with a template engine based on [tempura](https://github.com/lukeed/tempura). It bundles client assets: Rolldown builds the JavaScript, and LightningCSS builds the CSS. Then it writes the site to `public/`.

You write one config file, `bongo.config.ts`, and put your files in a small set of folders. [Project layout](/project/) describes each folder and each step of a build.

## Features

- **Content**: Markdown, HTML, and `.hbs` files become pages. Their paths set their URLs. See [Content](/content/).
- **Frontmatter**: a typed YAML subset at the top of each file. See [Frontmatter](/frontmatter/).
- **Templates**: layouts and partials with `$site`, `$page`, `$pages`, `$section`, `$tags`, and `$data`. See [Templates](/templates/) and [Partials](/partials/).
- **Data**: JSON, YAML, and module files in `data/` are available in every template. See [Data](/data/).
- **Assets**: `<bongo:script>`, `<bongo:style>`, and `<bongo:asset>` elements bundle and publish files under content-hashed names. See [Special elements](/templates/#special-elements).
- **Images**: bongo resizes and converts images, and gives them a `srcset`, a `width`, and a `height`. See [Images](/images/).
- **Dynamic images**: draw a partial as an image, such as a social card for each page. See [Dynamic images](/dynamic-images/) and [Open Graph images](/open-graph-images/).
- **CSS**: bundling, autoprefixing, nesting, CSS modules, and packages in `@import`. See [CSS](/css/).
- **Output files**: a sitemap, a `robots.txt`, or a feed from one `.hbs` file. See [Output files](/output-files/).
- **Data modules**: JSON files from a TypeScript or JavaScript module, such as a search index. See [Data modules](/data-modules/).
- **Client runtime**: optional client-side navigation, prefetch, and view transitions. See [Client runtime](/client-runtime/) and [View transitions](/view-transitions/).
- **Dev server**: live reload and an error overlay. See [Dev server](/dev-server/).
- **Hooks**: change each page before bongo writes it. See [Hooks](/hooks/).

## Packages

| Package | Description |
| --- | --- |
| `bongo` | The core static site generator and the optional browser runtime. |
| `@bongo/markdown` | Markdown loader plugin. See [@bongo/markdown](/markdown/). |
| `@bongo/feed` | RSS and Atom feed plugin. See [@bongo/feed](/feed/). |
| `create-bongo` | Project scaffolding CLI. See [Quick start](/quick-start/). |

The core package is published as `@lukeed/bongo`. Install it and import it through the `bongo` alias:

```sh
bun add bongo@npm:@lukeed/bongo
```

All examples in these docs use the name `bongo`.

## Runtimes

bongo runs in Bun 1.4 or later, Deno, and Node 24 or later. Image processing uses `Bun.Image`, so it needs the Bun runtime. Without Bun, bongo copies each image as it is. See [Images](/images/#bun-runtime). [Dynamic images](/dynamic-images/) work in every runtime as SVG and PNG, and need Bun for JPEG and WebP.

## Work on bongo

The bongo repository holds the static site generator, its Markdown and feed plugins, the project scaffolder, and an example site for development. Bun 1.4 or later is the primary development tool. Node 24 or later is still supported at runtime, but the workspace commands use Bun:

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

- [Quick start](/quick-start/): create a site and run it.
- [Project layout](/project/): learn what each folder does.
- [Config](/config/): see every config field.
