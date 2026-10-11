# bongo

> A static site generator built on Rolldown and LightningCSS.

Published as `@lukeed/bongo`, but projects should install and reference it through the `bongo` alias:

```sh
bun add bongo@npm:@lukeed/bongo
```

All examples below use `bongo`.

## Overview

`bongo` processes content files through a loader pipeline, applies layouts and partials with a tempura-based template engine, and bundles client assets with Rolldown for JavaScript and LightningCSS for CSS.

## Usage

```sh
bongo build
bongo dev
```

CLI options:

```sh
bongo build -C site --minify
bongo dev -C site --host --port 3000
bongo build --debug
```

`--debug` logs each stage of a build, such as `loading the config and data/` or `bundling assets`, and how long it took. Without it, a stage that is still running after 15 seconds prints `still <stage>` every 15 seconds, so a build that waits on something, like a top-level `await` in your config, says what it waits on.

### Output folder

`bongo build` and `bongo dev` empty `public/` when they start, before they load the config, so no file from an earlier run stays. `bongo dev` empties it before its server starts, and each rebuild then deletes only the files that the new build no longer writes.

bongo deletes a symlink in `public/`, but never the file or folder that it points to. It refuses to empty `public/`, and the build fails, when the folder resolves through symlinks to:

- the project root, or a folder above it,
- a folder outside the project,
- `assets/`, `content/`, `data/`, `layouts/`, or `partials/`, or a folder in one of them or that holds one of them,
- the home folder, a folder above it, or `/`.

### Minify

`--minify` minifies every JavaScript bundle with Rolldown and every stylesheet with LightningCSS, including inline ones. It also minifies the HTML pages with [tdewolff/minify](https://github.com/tdewolff/minify) when its `minify` CLI is on your `$PATH`. If the CLI is missing, the build still succeeds: it prints one notice and leaves the HTML as it is. Without `--minify`, nothing is minified.

## How It Works

When you run `bongo build`:

1. `public/` is emptied. Config is loaded from `bongo.config.{ts,mjs,cjs,js}` by walking upward from `cwd`. Rolldown bundles the config and the local files it imports into one temporary `.mjs` module, which bongo imports and then deletes. This works the same in Bun, Deno, and Node. Packages stay external and resolve as usual, and `import.meta.url`, `import.meta.dirname`, and `__dirname` keep pointing at each source file. TypeScript partials and `data/` modules load the same way.
2. Files in `data/` are loaded as `$data`. Layouts and partials are collected from `layouts/` and `partials/`. Handlebars files (`.hbs`) are compiled with tempura. JavaScript and TypeScript partials are loaded as modules.
3. Content files are passed through registered loaders, then rendered through the matching layout chain. [Output files](#output-files), such as `sitemap.xml.hbs`, get no layout.
4. Rendered HTML is scanned for `<bongo:*>` elements, and each page's content for `<img>` elements with a relative `src`. Assets are registered and replaced with placeholder tokens.
5. Asset groups are flushed. JavaScript goes through Rolldown; CSS goes through LightningCSS; images go through `Bun.Image`. Output filenames include content hashes.
6. Placeholders are substituted with external asset URLs or inline asset contents.
7. Pages are written to `public/`. With `--minify`, they are then minified when the `minify` CLI is available.

## Config

```ts
import { markdown } from '@bongo/markdown';
import { shiki } from '@bongo/markdown/highlight';

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
	},

	$utils: {
		excerpt(text: string, len: number) {
			return text.slice(0, len);
		},
	},

	plugins: [
		markdown({
			highlighter: shiki({
				theme: 'github-dark',
				langs: ['js', 'ts', 'css', 'bash'],
			}),
		}),
	],
};
```

Config fields:

- `$site` — site metadata; available in templates as `{{$site.title}}`. The `url` field also drives `publicPath`.
- `$assets` — loader map keyed by file extension.
- `$utils` — helper functions available in templates.
- `$partials` — programmatic partial functions.
- `$images` — image defaults; see [Images](#images).
- `$hooks` — functions that change the build output; see [Hooks](#hooks).
- `plugins` — array of partial config objects, merged in order.

## Frontmatter

A content file can start with a YAML block between two `---` lines. Its values become `$page.params`.

```yaml
---
title: Hello, world
date: 2024-05-01
draft: false
weight: 3
tags: [js, css]
authors:
  - name: Luke
    url: https://lukeed.com
cover:
  src: hero.webp
  alt: "Issue #1"
---
```

bongo reads a small subset of YAML:

- Values are typed. `42` and `-1.5` are numbers, `true` and `false` are booleans, and `null`, `~`, and an empty value are `null`. Everything else is a string.
- Dates stay strings, as written. Text like `1.0.0`, and numbers with a leading zero like `007`, also stay strings.
- A string can be plain, `'single-quoted'` (write `''` for a quote), or `"double-quoted"` with backslash escapes like `\n` and `\"`. A quoted value is always a string.
- Lists are inline, `[a, b]`, or one `- item` per line. Maps are inline, `{a: 1}`, or nested by indentation. Indent with spaces, not tabs.
- `#` after a space starts a comment.
- A plain value runs from the first `: ` to the end of the line, so `summary: Install with: brew` works. A value that only starts like a quoted string, list, or map, such as `[WIP] Notes`, is plain text.
- Not supported: multi-line strings (`|`, `>`, or a value that continues on the next line), anchors, aliases, and tags. Inline lists and maps must fit on one line.

An error names the file and the line, for example `content/blog/post.md: Invalid frontmatter: duplicate key "title" at line 3`.

`$page.title` and `$page.summary` are always text, so `title: 2024` gives `"2024"`. `$page.tags` takes a list or a comma-separated string.

### Migrate from string-only frontmatter

Older versions of bongo read every value as a string and split each line on its first `:`. To update a site:

- `hidden: true` is now the boolean `true`, not `'true'`. Compare with `=== true`.
- `stars: 120` is now the number `120`. In templates, `+` now adds instead of joins.
- `forks: 0` is now the number `0`, which `{{#if $page.params.forks}}` treats as false. To show zeros, test `{{#if $page.params.forks != null}}`.
- `version: 1.0` is now the number `1`. Quote values that must stay text: `version: "1.0"`.
- `title: Issue #42` is now `Issue`, because ` #` starts a comment. Quote it: `title: "Issue #42"`.
- `note:` with no value is now `null`, not `''`.
- A line that is not `key: value` is now an error, and so is a duplicate key.
- `key:` followed by indented lines is now a nested map or list.

## Data

Put JSON, YAML, or module files in `data/` to use them in every template as `$data`. A file's key is its path without the extension:

| File | Template value |
| --- | --- |
| `data/site.yaml` | `$data.site` |
| `data/oss/history.json` | `$data.oss.history` |
| `data/stats.ts` | `$data.stats`, the module's default export |

```hbs
<ul>
{{#each $data.oss.history as row}}
  <li>{{ row[0] }}: {{ row[1] }}</li>
{{/each}}
</ul>
```

- YAML files use the same subset as [Frontmatter](#frontmatter).
- A `.ts`, `.mts`, `.js`, `.mjs`, or `.cjs` file must have a default export. It can use top-level `await`, for example to fetch data at build time.
- Use brackets for a key that is not a valid name: `$data.oss['arr-filter']`.
- Data from JSON and YAML files is read-only. Copy it before you sort it: `$data.posts.toSorted(...)`.
- bongo skips files and folders whose names start with `.`. Any other file type fails the build. Two files with the same key, such as `data/a.json` and `data/a.yaml`, also fail the build.

`$data` is available in layouts, partials, and `.hbs` content. Helpers in `$utils` do not get it automatically. Give them the value they need: `{{ $utils.total($data.oss.history) }}`.

## Loaders

Loaders transform content files by file extension. Register them with `$assets`:

```ts
export const $assets = {
	md(filename, content, utils) {
		return {
			filename: filename + '.html',
			content: renderedHtml,
			metadata: { title: '...' },
		};
	},
};
```

> **Note:** You can use `@bongo/markdown` for a ready-made solution.

Loaders are chained by extension. A `.md` file produces `.md.html`, the `.html` extension stops the chain and enters the template pipeline.

Loader utilities:

- `utils.decode(uint8array)` — convert a buffer to a string.
- `utils.render(partialName, args)` — invoke a registered partial.
- `utils.attrs(input)` — parse element attributes, like `title="Hi" count=2 tags=[a, b] featured`, into data. Values are never evaluated. `@bongo/markdown` uses it for `<bongo:*>` partial elements.
- `utils.frontmatter(content)` — parse the `---` block at the top of `content`, as described in [Frontmatter](#frontmatter). Returns `{ offset, value }`, where `offset` is where the body starts.

## Hooks

`$hooks.transform(text, ctx)` changes each page and each [output file](#output-files) after it renders and before bongo writes it. Pages arrive with their final asset URLs. Return the new text, or a promise of it.

```ts
export default {
	$hooks: {
		transform(text, ctx) {
			return ctx.kind === 'page' ? text.replace('{year}', String(new Date().getFullYear())) : text;
		},
	},
};
```

`ctx` has:

- `kind` — `'page'` or `'output'`.
- `path` — the URL path, such as `/blog/post/` or `/blog/index.xml`.
- `params` — the frontmatter.
- `outputs` — every output file of the build, as `{ path, params }`, sorted by path.
- `config` — the config, with its plugins merged.

When plugins and the config each set `transform`, all of them run: first the plugins, in order, then the config's own. Each one gets the text that the one before it returned. If one throws, the build fails, and the error names the content file and the layouts that rendered it.

## publicPath

The `publicPath` prefix applied to external asset URLs is derived from `$site.url`:

- Root-served site (`https://example.com`) -> `publicPath = /`
- Subpath-served site (`https://example.com/blog/`) -> `publicPath = /blog/`

No manual configuration is required. The absolute `url` of each page, in `$page.url` and `$pages`, includes the subpath too: `content/post.md` is `https://example.com/blog/post/`.

## Templates

Templates use [tempura](https://github.com/lukeed/tempura) syntax. Asset entrypoints are declared with `<bongo:style>`, `<bongo:script>`, `<bongo:client>`, `<bongo:asset>`, and `<bongo:image>` custom elements. `<bongo:image>` is described in [Images](#images).

```hbs
{{! layouts/html.hbs }}
<!doctype html>
<html lang="{{$site.lang}}">
<head>
  <meta charset="utf-8"/>
  <title>{{ $page.title }}</title>

  {{! External CSS: emits <link rel="stylesheet" href="/style.hash.css"/> }}
  <bongo:style src="app.css"></bongo:style>

  {{! Inline CSS: splices built file contents into a <style> block }}
  <bongo:style src="print.css" inline></bongo:style>
</head>
<body>
  {{{ $page.content }}}

  {{! External JS: emits <script type="module" src="/main.hash.js"></script> }}
  <bongo:script src="main.ts"></bongo:script>

  {{! Async external JS }}
  <bongo:script src="analytics.ts" async></bongo:script>

  {{! Inline JS: file contents spliced into the <script> element }}
  <bongo:script src="boot.ts" inline></bongo:script>
</body>
</html>
```

`<bongo:style>` attributes:

- `src="..."` — path relative to `assets/`.
- `inline` — splice built CSS directly into a `<style>` block. Omit for an external stylesheet link.
- `global` — disable CSS modules auto-detection on `*.module.css` sources.

`<bongo:script>` attributes:

- `src="..."` — path relative to `assets/`.
- `inline` — splice built JavaScript directly into a `<script>` block.
- `async` — add the `async` attribute to an external script.
- `defer` — add the `defer` attribute for CJS output. ESM modules are deferred by the browser.
- `format="esm"|"cjs"` — output module format. Defaults to `esm`.
- `target="..."` — browserslist target string.

`<bongo:client>` bundles bongo's browser runtime and emits a module script that calls `client(...)`. It emits only that script, so you can put it anywhere in `<head>` or `<body>`:

```hbs
<bongo:client />
<bongo:client transitions />
<bongo:client transitions="slide" />
```

Multiple `<bongo:client>` tags on a page share one bundled runtime.

`<bongo:asset>` publishes any file from `assets/`, such as a font, image, or icon, under a content-hashed name. It goes through the same pipeline as files referenced from CSS `url()`: a file used by both gets one copy and one URL. That makes it the way to preload a font that your CSS loads.

```hbs
{{! Preload: emits <link rel="preload" href="/inter.3f9a1c2e.woff2" as="font" type="font/woff2" crossorigin/> }}
<bongo:asset preload src="fonts/inter.woff2" />

{{! Plain: becomes the bare URL, so it works inside attributes }}
<link rel="icon" href="<bongo:asset src='img/favicon.png' />"/>
<img src="<bongo:asset src=img/hero.webp />" alt="…"/>
```

Without `preload`, the element is replaced by the file's public URL and nothing else. Inside an attribute, give `<bongo:asset>` its own attributes in single quotes or without quotes, so they do not end the outer attribute. The URL is percent-encoded, so it is safe in any attribute.

With `preload`, bongo emits a `<link rel="preload">` and infers its attributes from the file extension:

| Files | `as` | `type` | `crossorigin` |
| --- | --- | --- | --- |
| `.woff2`, `.woff`, `.ttf`, `.otf` | `font` | `font/woff2`, … | yes, as preload requires for fonts |
| images, such as `.png`, `.jpg`, `.svg`, `.webp`, `.avif` | `image` | `image/png`, … | no |
| `.css` | `style` | `text/css` | no |
| `.js`, `.mjs` | `script` | `text/javascript` | no |
| anything else, such as `.json` or `.wasm` | `fetch` | when known | yes |

`<bongo:asset>` attributes:

- `src="..."` — path relative to `assets/`.
- `preload` — emit a `<link rel="preload">` instead of the bare URL.
- `as="..."`, `type="..."` — override the inferred values. `type=false` leaves `type` out.
- `crossorigin` or `crossorigin="use-credentials"` — override the inferred value. `crossorigin=false` leaves it out.
- `media="..."`, `fetchpriority="high|low|auto"` — copied onto the `<link>`.

A `src` that does not exist fails the build. The error shows the element and the content file and layouts that rendered it.

## View Transitions

Add `transition:name` and `transition:animate` to HTML elements in a layout or partial. bongo rewrites them at build time.

```hbs
<header transition:name="site-header">...</header>
<nav transition:name="nav" transition:animate="slide">...</nav>
```

- `transition:name="NAME"` — removed from the element; `view-transition-name: NAME` is merged into the element's `style` attribute.
- `transition:animate="KEYFRAME"` — requires a named `@keyframes KEYFRAME` in your CSS. bongo injects a `<style data-bongo-transitions>` block in `<head>` that wires the keyframe to matching view-transition pseudo-elements.

If `transition:animate` is present without `transition:name`, an automatic name is generated.

## Partials

```hbs
{{#partial src="header" }}
{{#partial src="card" title="Hello" }}
```

## Template Variables

- `$site` — global site config.
- `$page` — current page. Includes `path`, `url`, `title`, `summary`, `params`, `section`, `tags`, and `content`.
- `$pages` — every page in the build, sorted by path.
- `$section` — pages scoped to the current page's section directory.
- `$tags` — array of `{ tag, pages }` entries.
- `$assets` — configured loader map.
- `$utils` — configured helper functions.
- `$data` — the files in `data/`. See [Data](#data).

Content files ending in `.hbs` are tempura-compiled with the same context as layouts: `$site`, `$page`, `$pages`, `$section`, `$tags`, `$assets`, `$utils`, `$data`, plus `params` as an alias for `$page.params`.

The current page's own `$page.content` is empty while its body is compiling. It is the value produced by that compile.

## Output files

A `.hbs` file in `content/` with a second extension that is not `.html` is an output file, not a page. bongo writes it to its own path, without the `.hbs`:

| File | Output |
| --- | --- |
| `content/sitemap.xml.hbs` | `/sitemap.xml` |
| `content/blog/index.xml.hbs` | `/blog/index.xml` |
| `content/robots.txt.hbs` | `/robots.txt` |

An output file compiles with the same values as `.hbs` content: `$site`, `$page`, `$pages`, `$section`, `$tags`, `$data`, `$utils`, and its own frontmatter as `params`. It is different from a page:

- It gets no layout. bongo writes it as it renders: it does not replace `<bongo:*>` elements or content images, adds no dev reload script, and never minifies it.
- It is not in `$pages`, `$section`, or `$tags`, so a sitemap or a feed never lists itself.
- Its frontmatter cannot set `url`. To change its path, rename the file.
- `bongo dev` serves it with the content type of its extension, such as `text/xml`, and renders it again after every change to a page, because it can read every page.

As in all templates, tempura removes the line break just before each `{{ }}` tag and at the end of the file. Put a tag at the end of its line to keep the output tidy. The output starts after the `---` line that closes the frontmatter, so an XML file can start with `<?xml`.

A sitemap, in `content/sitemap.xml.hbs`:

```hbs
<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{{#each $pages as page}}
	<url>
		<loc>{{ page.url }}</loc>
{{#if page.params.lastmod}}
		<lastmod>{{ page.params.lastmod }}</lastmod>
{{/if}}
	</url>
{{/each}}
</urlset>
```

A `robots.txt`, in `content/robots.txt.hbs`:

```hbs
User-agent: *
Allow: /
Sitemap: {{ $site.url }}sitemap.xml
```

A feed is an output file whose frontmatter has `format: rss` or `format: atom`. The [`@bongo/feed`](../plugin.feed/readme.md) plugin turns its `<feed:*>` elements into RSS or Atom, and each `<feed:link>` in your layouts into a link to it. In `content/blog/index.xml.hbs`:

```hbs
---
format: rss
title: My blog
---
<feed:channel>
{{#each $section.filter(post => post.params.date) as post}}
<feed:item href="{{ post.path }}" title="{{ post.title }}" date="{{ post.params.date }}" summary="{{ post.summary }}" />
{{/each}}
</feed:channel>
```

`content/feed.json.hbs` also works, but it is not recommended: `{{ }}` escapes text for HTML, not for JSON, so the output is easily invalid. If you must, print each value with `{{{ JSON.stringify(value) }}}`. Data modules for JSON output are planned in [#52](https://github.com/lukeed/bongo/issues/52).

## Images

bongo resizes and converts images with [`Bun.Image`](https://bun.com/docs/runtime/image), so image processing needs the Bun runtime. The `bongo` command starts with Node, so run it through Bun:

```sh
bunx --bun bongo build
bun --bun run build   # for a "build": "bongo build" script
```

Under Node, bongo copies each image as it is, under a hashed name, and prints one notice for each build. The build does not fail. It adds `width` and `height` only to SVG and GIF images.

JPEG, PNG, and WebP files are encoded with the same codecs on every platform, so a build makes the same bytes on macOS, Linux, and Windows.

bongo adds `width` and `height` to images. If your CSS limits the width of images, also give them `height: auto`, so they keep their aspect ratio:

```css
img { max-width: 100%; height: auto; }
```

### `<bongo:image>`

```hbs
<bongo:image src="img/hero.jpg" alt="A hero" sizes="(min-width: 800px) 720px, 100vw" />
```

With the default settings and a 2400×1600 JPEG, this becomes the following, on one line:

```html
<picture>
  <source type="image/webp" srcset="/hero-640.1a2b3c4d.webp 640w, /hero-960.2b3c4d5e.webp 960w, /hero-1280.3c4d5e6f.webp 1280w, /hero-1920.4d5e6f7a.webp 1920w, /hero-2400.5e6f7a8b.webp 2400w" sizes="(min-width: 800px) 720px, 100vw"/>
  <img src="/hero-2400.6f7a8b9c.jpg" srcset="/hero-640.7a8b9c0d.jpg 640w, /hero-960.8b9c0d1e.jpg 960w, /hero-1280.9c0d1e2f.jpg 1280w, /hero-1920.0d1e2f3a.jpg 1920w, /hero-2400.6f7a8b9c.jpg 2400w" sizes="(min-width: 800px) 720px, 100vw" alt="A hero" loading="lazy" decoding="async" width="2400" height="1600"/>
</picture>
```

The path in `src` tells bongo where the file is:

- `img/hero.jpg` is relative to `assets/`, as for `<bongo:asset>`.
- `./hero.jpg`, `../hero.jpg`, and `/blog/post/hero.jpg` resolve against the URL of the page, as a browser resolves them, and bongo reads the file from `content/`. For `content/blog/post.md`, which is served at `/blog/post/`, `./hero.jpg` is `content/blog/post/hero.jpg`. A root-relative path is relative to the site root, not to `publicPath`, so `{{ post.path }}{{ post.params.cover }}` works in a list of posts.

`<bongo:image>` attributes:

- `src="..."` — the image. Required.
- `sizes="..."` — defaults to `$images.sizes`.
- `widths="640,1280"`, `formats="webp,jpeg"`, `quality="60"` — override `$images` for this image.
- `width`, `height` — default to the size of the source. If you give only one, bongo calculates the other from the aspect ratio.
- `loading` — defaults to `lazy`, or to `eager` when `fetchpriority="high"`.
- `decoding` — defaults to `async`.
- All other attributes, such as `alt`, `class`, and `fetchpriority`, go on the `<img>`.

A `sizes` value that starts with `auto` lets the browser use the width of the image in the layout. Browsers use `auto` only for lazy images, so bongo removes it from eager images.

### Content images

By default, bongo also processes each `<img>` in content whose `src` is a relative path. This includes Markdown images, such as `![A hero](hero.jpg)`, and `<img>` elements that you write in Markdown, HTML, or `.hbs` content. The path resolves against the URL of the page, as for `./` paths.

The `<img>` stays where it is. bongo does not add a `<picture>`, so CSS such as `p > img` still applies. The `<img>` gets a `src`, `srcset`, and `sizes` in the first format in `$images.formats`, which is WebP by default and which every current browser supports, its `width` and `height`, `loading="lazy"`, and `decoding="async"`. Attributes that you write, such as `width`, `sizes`, or `loading`, stay as you wrote them.

bongo does not change an `<img>` that:

- has a `srcset`,
- is in a `<picture>`,
- has an absolute URL, a root-relative path such as `/img/a.png`, or a `data:` URL in `src`.

To leave all content images as written, set `$images.content` to `false`. To get a `<picture>` with all formats in Markdown, write a `<bongo:image>`.

### Processing

- bongo makes one file for each width in `widths` that is smaller than the source. If one or more widths are not smaller, bongo makes one file at the width of the source instead. bongo never enlarges an image.
- Files are named `name-width.hash.ext`. The hash comes from the contents of the source, the encoder settings, and the Bun version.
- bongo applies the EXIF orientation of JPEG files and removes the EXIF data, such as GPS positions. It keeps the color profile.
- bongo resizes JPEG, PNG, and WebP files. It copies all other images once under a hashed name, as for `<bongo:asset>`: SVG, GIF, TIFF, AVIF, HEIC, and animated PNG and WebP files. It adds their `width` and `height` when it can read them. For SVG, they come from the `width`, `height`, or `viewBox` attributes.

### Cache

bongo keeps encoded images in `node_modules/.cache/bongo/images`. A rebuild copies unchanged images from there, and encodes only new or changed images. To clear the cache, delete the directory.

bongo records when a build last used each cached file, as the file's modified time, which it updates at most once a day. At the end of a build, at most once a day, bongo deletes the files that no build has used for 30 days. Set `$images.prune` to another number of days, or to `false` to keep every file. When two builds run at the same time and one deletes a file that the other is about to use, the other encodes it again, so a prune never breaks a build.

### Dev

`bongo dev` does not encode images when it builds. It reads the size of each image and writes the pages, so the first build stays fast. The dev server encodes a file the first time that the browser asks for it, and then serves it from the cache. A browser asks for only one file per image, so most files are never encoded in dev. When you change an image, bongo rebuilds, and the page reloads with the new URLs.

### Errors

A missing image fails the build. The error shows the element and the files that rendered it:

```
Missing "content/blog/post/hero.jpg" for <img src="hero.jpg" alt="">, rendering content/blog/post.md
```

An image path that resolves outside `assets/` or `content/` also fails the build.

`Bun.Image` encodes AVIF only on Apple Silicon M3 or newer Macs and on Windows. If you ask for `avif` on another machine, such as Linux CI, the build fails and says so.

### Image config

```ts
export default {
	$images: {
		widths: [640, 960, 1280, 1920, 2880],
		formats: ['webp', 'original'],
		quality: { avif: 50, webp: 80, jpeg: 80 },
		sizes: 'auto, 100vw',
		content: true,
		prune: 30,
	},
};
```

These are the defaults.

- `widths` — output widths, in pixels. 2880 serves a full-width image on a 1440 pixel screen with a pixel ratio of 2.
- `formats` — `avif`, `webp`, `jpeg`, `png`, or `original`, best first. `original` is the format of each source. Content images use only the first format. `<bongo:image>` puts the last format in its `<img>` as the fallback and the others in `<source>` elements. Both should be formats that all browsers support. `avif` is not in the defaults, because only some machines can encode it.
- `quality` — from 1 to 100, for AVIF, WebP, and JPEG. Give one number for all of them, or one number for each format. PNG is always lossless.
- `sizes` — the `sizes` of images that do not have one.
- `content` — process `<img>` elements in content.
- `prune` — delete cached images that no build has used for this many days, or `false` to keep them all.

## CSS

All CSS is handled by [LightningCSS](https://lightningcss.dev): `@import` bundling, autoprefixing, nesting, and optional minification.

`.module.css` files automatically enable CSS modules. Non-module files can opt in explicitly when registering the entry.

### Files in `url()`

Fonts, images, and other files that CSS references with a relative `url()` can live next to the CSS under `assets/`. Each `url()` resolves against the CSS file that contains it, including files pulled in with `@import`.

```css
/* assets/theme/fonts.css */
@font-face {
	font-family: Inter;
	src: url("../fonts/inter.woff2") format("woff2");
}
```

bongo copies each referenced file to the output once, with a content hash in its name, and rewrites the `url()` to its public path under `publicPath`, for example `url("/inter.3f9a1c2e.woff2")`. A `?query` or `#fragment` on the URL is kept. Linked and inline styles behave the same, and `bongo dev` rebuilds when a referenced file changes.

These URLs are left as written:

- external URLs, such as `https:`, `//cdn.example.com/…`, and `data:`
- root-relative URLs, such as `/img/logo.png`, which point at files from `content/`
- fragment-only URLs, such as `url(#gradient)`

If a relative `url()` points at a file that does not exist, the build fails with an error that names the URL and the CSS file that contains it.

## Dev Server

`bongo dev` starts the HTTP server and runs the initial build behind it. File changes in `assets/`, `layouts/`, `partials/`, or `content/` trigger a rebuild.

A change to the config, to any local file it imports, or to anything in `data/` loads the config and data again, then rebuilds every page. You do not need to restart. If the config or a data file fails to load, the error overlay shows the error, and the last good build keeps serving until you fix it. The same is true for a rebuild that fails.

A path with no matching file gets a `404` status, the same as on a static host, so broken links show up during development. The response body is your own 404 page when the build has one: `404.html`, or `404/index.html` (which `content/404.md` produces).

Rebuilds push one of these SSE messages to the browser:

| Message | Meaning |
|---|---|
| `{ type: 'reload' }` | Successful rebuild; browser reloads the page. |
| `{ type: 'error', errors }` | Build failed; full-viewport error overlay mounts. |
| `{ type: 'error-clear' }` | Next successful build; overlay unmounts, then the browser reloads. |

The `hmr` message type exists in the type union for forward compatibility. Today, file changes trigger a full reload.

## Client Runtime

`bongo/client` turns a statically generated site into a client-navigated SPA.

```ts
import { client, navigate, on, off } from 'bongo/client';
```

The simplest setup is the `<bongo:client />` element:

```hbs
{{! layouts/html.hbs }}
<bongo:client transitions />
```

That expands at build time to:

```html
<script type="module">
  import { client } from "/client.D59fAaym.js";
  client({ transitions: true });
</script>
```

At startup, the runtime adds a hidden `aria-live` region, `<div id="bongo:live">`, at the start of `<body>`. It keeps that element across navigations and writes the new page title into it after each one. If the page already has an element with that id, the runtime uses it.

If you also need custom event handlers or boot code, keep a separate `<bongo:script>`:

```hbs
<bongo:client transitions />
<bongo:script src="main.ts"></bongo:script>
```

```ts
import { on } from 'bongo/client';

on('bongo:navigated', ({ to }) => {
	console.log('navigated to', to.pathname);
});
```

Or call `client()` yourself:

```ts
import { client } from 'bongo/client';

client({ transitions: true });
```

### ClientOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `transitions` | `boolean \| 'fade' \| 'initial' \| 'slide' \| string` | `false` | View-transition preset. `true` / `'fade'` injects a cross-fade keyframe. `'slide'` injects a slide keyframe. `'initial'` wraps the swap without injecting CSS. Custom string wraps only; user CSS provides the rules. Any falsy value disables transitions. Opt a link out with `transition:disable`. |
| `prefetch` | `boolean \| 'hover' \| 'tap'` | `false` | Prefetch same-origin links into the in-memory HTML cache, and fetch the new stylesheets of each page into the HTTP cache. `true` / `'hover'` fires after hover settles, or immediately on touch. `'tap'` fires on `mousedown` / `touchstart`. Opt a link out with `prefetch:disable`. |

### Events

Subscribe with `on(event, handler)`. It returns an unsubscribe function. Remove a specific handler with `off(event, handler)`.

```ts
on('bongo:navigated', ({ to }) => {
	console.log('navigated to', to.pathname);
});
```

| Event | Detail shape | Fires when |
|---|---|---|
| `bongo:ready` | `{ url: URL }` | Once, immediately after `client()` is called. |
| `bongo:navigate` | `{ to: URL; from: URL }` | Navigation intercepted, before the fetch. |
| `bongo:replace` | `{ to: URL; from: URL; doc: Document }` | HTML fetched and parsed; swap has not happened yet. |
| `bongo:replaced` | `{ to: URL; from: URL }` | DOM swapped. |
| `bongo:navigated` | `{ to: URL; from: URL }` | Navigation settled. |
| `bongo:error` | `{ to: URL; error: Error }` | Navigation fetch or swap threw. |

### Programmatic Navigation

```ts
navigate('/about');
navigate('/old-url', { replace: true });
```

`navigate()` returns `Promise<void>` and resolves when navigation and any transition complete.

### Opt Out

Force a full-page load:

```html
<a href="/legacy" transition:disable>Legacy dashboard</a>
```

Disable prefetch without forcing a full-page load:

```html
<a href="/logout" prefetch:disable>Log out</a>
```

### Stylesheets

On navigation, the runtime compares the `<link rel="stylesheet">` and `<style>` elements in the `<head>` of the two pages. It keeps the stylesheets that both pages use. It adds the new stylesheets in the order of the new page, but keeps them disabled, so the current page does not change. When each new stylesheet loads or fails, or after 3 seconds, the swap enables the new stylesheets, replaces `<body>`, and removes the stylesheets that the new page does not use. A view transition starts only after this wait.

- A `<link>` matches by its resolved `href`, its `media`, and its `disabled` attribute. A `<style>` matches by its content and its `media`.
- The runtime does not wait for a stylesheet that does not apply, such as a `disabled` link or a `media` query that does not match.
- The runtime never removes a stylesheet that a script adds after `client()` starts.
- Stylesheets in `<body>` change with the body.

With `prefetch`, the runtime also fetches the new stylesheets of a page before the click. If the server lets the browser reuse them without a new request, for example with a long `max-age` on hashed files, navigation does not wait for them.

### Scroll Restoration

`client()` sets `history.scrollRestoration = 'manual'`.

- Back / forward restores the saved `{x, y}` position for that URL.
- Push / replace scrolls to the hash element if present, otherwise `(0, 0)`.

### Browser Support

The Navigation API is available in Chrome and Edge, and is behind a flag or unsupported in Firefox and Safari at time of writing. If the API is absent, `client()` emits `bongo:ready` and returns without installing navigation interception.

## TypeScript

`bongo` ships ambient JSX types for its custom elements and attributes. Extend the bundled config:

```json
{
	"extends": "bongo/tsconfig",
	"compilerOptions": {
		// your own settings
	}
}
```

The augmentation adds:

- `<bongo:asset>`, `<bongo:client>`, `<bongo:image>`, `<bongo:script>`, and `<bongo:style>` intrinsic elements.
- `transition:name` and `transition:animate` on every HTML element.
- `transition:disable` and `prefetch:disable` on anchors.

Or reference the types directly:

```ts
/// <reference types="bongo/jsx" />
```
