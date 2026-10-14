---
title: Project layout
summary: The folders of a bongo project, what bongo does with each one, and the steps of a build.
group: Start
order: 3
---

A bongo project is a folder with a config file and a set of fixed folders. bongo finds each folder in the project folder: the current folder, or the folder that you give to `-C`.

## Folders

```
my-site/
├── assets/
├── content/
├── data/
├── layouts/
├── partials/
├── public/
└── bongo.config.ts
```

| Path | What bongo does with it |
| --- | --- |
| `assets/` | Holds the source files of scripts, styles, fonts, and images. Each `src` of a `<bongo:script>`, `<bongo:style>`, `<bongo:asset>`, or `<bongo:image>` element is relative to `assets/`. |
| `content/` | Holds the pages, output files, and data modules. A file's path sets its URL. |
| `data/` | Holds JSON, YAML, and module files. Templates get them as `$data`. |
| `layouts/` | Holds the `.hbs` layouts that wrap pages. |
| `partials/` | Holds the `.hbs`, JavaScript, and TypeScript partials. |
| `public/` | Receives the output of `bongo build`. bongo empties it at the start of each build. `bongo dev` keeps its output in memory. |
| `bongo.config.ts` | The config. |

### `assets/`

bongo does not copy `assets/` as a whole. It builds and publishes only the files that your templates and your CSS reference, each under a content-hashed name. See [Special elements](/docs/templates/#special-elements) and [CSS](/docs/css/).

### `content/`

Each `.md`, `.html`, and `.hbs` file becomes a page. A `.hbs` file with a second extension, such as `sitemap.xml.hbs`, becomes an [output file](/docs/output-files/). A `.json.ts` or `.json.js` file becomes a [data module](/docs/data-modules/). bongo copies all other files, such as images next to a post, to the same path in `public/`. See [Content](/docs/content/).

### `data/`

bongo loads the files in `data/` together with the config, and gives them to every template as `$data`. See [Data](/docs/data/).

### `layouts/` and `partials/`

A layout wraps a page. bongo finds the layout of each page by its path, and every page needs a `layouts/html.hbs`. See [Layouts](/docs/templates/#layouts).

A partial is a template that layouts, `.hbs` content, and Markdown can call by name. See [Partials](/docs/partials/).

### `public/`

`bongo build` empties `public/` when it starts. `bongo dev` keeps its output in memory and does not touch `public/`, unless you pass `--write`. bongo refuses to empty the folder when it is not a safe folder. See [Output folder](/docs/cli/#output-folder).

### `bongo.config.ts`

The config can also be `bongo.config.mjs`, `bongo.config.cjs`, or `bongo.config.js`. When more than one exists, bongo uses the first in this order: `.ts`, `.mjs`, `.cjs`, `.js`. Without a config, the build stops with `Missing configuration file`. See [Config](/docs/config/).

## How a build works

When you run `bongo build`, bongo does these steps:

1. `bongo build` empties `public/`. Then bongo loads the config, `bongo.config.{ts,mjs,cjs,js}`. Rolldown bundles the config and the local files that it imports into one temporary `.mjs` module. bongo imports that module, then deletes it. This works the same in Bun, Deno, and Node. Packages stay external and resolve as usual. A package linked into `node_modules` from outside it, such as a workspace package, is local code: bongo bundles it too, and the packages it imports resolve from its own folder. `import.meta.url`, `import.meta.dirname`, and `__dirname` keep pointing at each source file. TypeScript partials, `data/` modules, and [data modules](/docs/data-modules/) load the same way.
2. It loads the files in `data/` as `$data`. It collects layouts from `layouts/` and partials from `partials/`. It compiles the Handlebars files (`.hbs`) with tempura, and loads the JavaScript and TypeScript partials as modules.
3. It passes the content files through the registered [loaders](/docs/loaders/), then renders each page through its matching [layout chain](/docs/templates/#layouts). [Output files](/docs/output-files/), such as `sitemap.xml.hbs`, get no layout. [Data modules](/docs/data-modules/), such as `search.json.ts`, run when every page is known, and write JSON.
4. It scans the rendered HTML for `<bongo:*>` elements, and the content of each page for `<img>` elements with a relative `src`. It registers each asset and replaces it with a placeholder token.
5. It flushes the asset groups. JavaScript goes through Rolldown, CSS goes through LightningCSS, and images go through `Bun.Image`. Output file names include content hashes.
6. It replaces the placeholders with external asset URLs or with inline asset contents.
7. It passes each page and output file to [`$hooks.transform`](/docs/hooks/), and writes the pages to `public/`. `bongo dev` keeps them in memory. With `--minify`, it then minifies the pages when the `minify` CLI is available. See [Minify](/docs/cli/#minify).
