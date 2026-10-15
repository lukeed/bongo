---
title: Special elements
summary: Each <bongo:*> element, its attributes, and the HTML that bongo writes in its place.
group: Reference
order: 3
---

bongo replaces `<bongo:*>` elements in the HTML of each page, after the layouts render. They work in layouts, partials, and content. Write one as `<bongo:style src="app.css" />` or as `<bongo:style src="app.css"></bongo:style>`. For an introduction, see the [Templates guide](/templates/#special-elements).

- Each `src` is a path relative to `assets/`. `<bongo:image>` also takes paths in `content/`.
- A `src` that does not exist fails the build. The error shows the element, and the content file and layouts that rendered it.
- The built files get content-hashed names, such as `/app.3f9a1c2e.css`. On a site under `/blog/`, the URLs start with `/blog/`.
- bongo does not replace them in [output files](/output-files/) or in the templates of [dynamic images](/dynamic-images/).

## Attribute values

bongo reads attribute values as data, and never runs them as code:

- A quoted value, `"…"` or `'…'`, is a string.
- A bare value is a number, `true`, `false`, `null`, or else text, so `src=img/a.png` is a string.
- A name with no value is `true`.

## `<bongo:style>`

Builds a stylesheet with LightningCSS. See [CSS](/css/).

```hbs
<bongo:style src="app.css" />
```

becomes:

```html
<link rel="stylesheet" href="/app.3f9a1c2e.css"/>
```

- `src` — the stylesheet. Required.
- `inline` — write the built CSS in a `<style>` element, in place of the `<link>`.
- `global` — turn off [CSS modules](/css/#css-modules) for a `*.module.css` file.

All other attributes, such as `media`, `nonce`, and `title`, go on the `<link>` or the `<style>`:

```hbs
<bongo:style src="print.css" media="print" nonce="__CSP_NONCE__" />
```

becomes:

```html
<link rel="stylesheet" href="/print.3f9a1c2e.css" media="print" nonce="__CSP_NONCE__"/>
```

A built page is the same for each request, but a CSP nonce must change for each response. Thus give a placeholder, such as `__CSP_NONCE__`, and let your host put a new nonce in its place for each response.

## `<bongo:script>`

Bundles a script with Rolldown.

```hbs
<bongo:script src="main.ts" />
```

becomes:

```html
<script type="module" src="/main.DFHWkANP.js"></script>
```

- `src` — the entry file. Required.
- `inline` — write the built JavaScript in the `<script>` element. bongo builds an inline script alone, with no shared chunks, so it imports nothing.
- `format` — `esm`, `iife`, or `cjs`. See [Formats](#formats).
- `async` — add `async`.
- `defer` — add `defer` to an `iife` or `cjs` script. A module script is deferred already.
- `target` — a browserslist query for this script. It replaces [`$build.target`](/config/#build-targets).

All other attributes, such as `nonce` and `id`, go on the `<script>`. `format` sets its `type`.

### Formats

| `format` | Element | Runs |
| --- | --- | --- |
| `esm`, the default | `<script type="module">` | after the page is parsed |
| `iife` | `<script>`, with the code in a function | at once, and blocks parsing |
| `cjs` | `<script>`, with CommonJS code | at once, and blocks parsing |

A module script can share chunks with the other module scripts of the site. bongo builds each `iife` and `cjs` script alone, with its dynamic imports inlined, since a classic script cannot load chunks. A browser has no `require` or `exports`, so prefer `iife` to `cjs`. Any other `format` fails the build.

Use an inline `iife` script for code that must run before the page paints, such as code that sets a color theme:

```hbs
<head>
	<bongo:script src="theme.ts" format="iife" inline />
</head>
```

## `<bongo:asset>`

Publishes any file of `assets/`, such as a font, an image, or an icon. A file that `<bongo:asset>` and a CSS `url()` both use gets one copy and one URL.

Without `preload`, the element becomes the URL of the file, and nothing else. Thus it works inside an attribute. Give it single quotes, or no quotes, so that its attributes do not end the outer attribute:

```hbs
<link rel="icon" href="<bongo:asset src='img/favicon.png' />"/>
```

becomes:

```html
<link rel="icon" href="/favicon.5ba42deb.png"/>
```

With `preload`, it becomes a `<link rel="preload">`. Preload a font that your CSS loads:

```hbs
<bongo:asset preload src="fonts/inter.woff2" />
```

becomes:

```html
<link rel="preload" href="/inter.22f9b928.woff2" as="font" type="font/woff2" crossorigin/>
```

bongo finds `as`, `type`, and `crossorigin` from the file extension:

| Files | `as` | `type` | `crossorigin` |
| --- | --- | --- | --- |
| `.woff2`, `.woff`, `.ttf`, `.otf` | `font` | `font/woff2`, … | yes, as preload requires for fonts |
| images, such as `.png`, `.jpg`, `.svg`, `.webp`, `.avif` | `image` | `image/png`, … | no |
| `.css` | `style` | `text/css` | no |
| `.js`, `.mjs` | `script` | `text/javascript` | no |
| anything else, such as `.json` or `.wasm` | `fetch` | when known | yes |

- `src` — the file. Required.
- `preload` — write a `<link rel="preload">`, in place of the URL.
- `as`, `type` — replace the value from the extension. `type=false` leaves `type` out.
- `crossorigin` or `crossorigin="use-credentials"` — replace the value from the extension. `crossorigin=false` leaves it out.
- `media`, `fetchpriority` — copied onto the `<link>`.

The URL is percent-encoded, so it is safe in any attribute.

## `<bongo:client>`

Bundles the [client runtime](/client-runtime/), and starts it. It has no `src`. Its attributes become the [client options](/client-runtime/#clientoptions):

```hbs
<bongo:client transitions prefetch="hover" />
```

becomes:

```html
<script type="module">import { client } from "/client.Cl9e57TG.js"; client({ transitions: true, prefetch: "hover" });</script>
```

It writes only that script, so you can put it anywhere in `<head>` or `<body>`. More than one `<bongo:client>` on a page share one bundled runtime. A `nonce` goes on the `<script>`, not into the options.

## `<bongo:image>`

Resizes and converts an image with `Bun.Image`, and writes a `<picture>` with a `srcset` for each format. Under Deno and Node, bongo copies the image as it is. See [Images](/images/).

```hbs
<bongo:image src="img/hero.jpg" alt="A hero" sizes="(min-width: 800px) 720px, 100vw" />
```

The `src` is relative to `assets/`. A path that starts with `./`, `../`, or `/` resolves against the URL of the page, and bongo reads the file from `content/`. See [Source paths](/images/#source-paths).

- `src` — the image. Required.
- `sizes` — defaults to `$images.sizes`.
- `widths="640,1280"`, `formats="webp,jpeg"`, `quality="60"` — replace the [`$images`](/images/#image-config) values for this image.
- `width`, `height` — default to the size of the source. If you give only one, bongo calculates the other from the aspect ratio.
- `loading` — defaults to `lazy`, or to `eager` when `fetchpriority="high"`.
- `decoding` — defaults to `async`.

All other attributes, such as `alt`, `class`, and `fetchpriority`, go on the `<img>`.

## `<bongo:alternate>`

Writes a `<link rel="alternate">`, which names another version of the page. For `type="text/markdown"`, bongo also writes a Markdown copy of the page. See the [llms.txt guide](/llms-txt/).

```hbs
<bongo:alternate type="text/markdown" />
```

becomes, on the page `/config/`:

```html
<link rel="alternate" type="text/markdown" href="/config.md"/>
```

- `type` — the media type of the other version. Required.
- `href` — its URL. For `text/markdown`, it defaults to the route of the page plus `.md`, as [`$utils.url.ext()`](/utilities/#urlextpath-ext) gives it. Other types need it. A relative `href` resolves against the URL of the page, as a browser resolves it.

All other attributes, such as `title` and `hreflang`, go on the `<link>`. Other types are a plain link, such as a feed or a translation:

```hbs
<bongo:alternate type="application/rss+xml" href="/feed.xml" title="Blog" />
<bongo:alternate type="text/html" hreflang="fr" href="/fr/config/" />
```

### Markdown copies

When the type is `text/markdown`, and the `href` is a file of the site, bongo writes a copy of the page there: the `title` and the `summary` of its frontmatter, then the Markdown of the page as you wrote it.

- A page from an `.html` or `.hbs` file has no Markdown to copy. It gets no copy and no `<link>`, so one layout can serve every page.
- bongo reads the source again when it writes the copy, so the build does not keep it in memory. `bongo dev` makes a copy the first time that you open it.
- The same `href` twice on one page writes one copy. Two pages that name the same file, or a copy that lands on another file of the site, fail the build.

Output files and data modules see the alternates of each page in [`$pages`](/variables/#pages). A page's own templates do not, because bongo finds the element after the layouts render.

## Reserved names

With [`@bongo/markdown`](/markdown/#elements), a `<bongo:name>` element in Markdown calls the partial with that name. The names `alternate`, `asset`, `client`, `image`, `script`, and `style` belong to bongo. Markdown passes those elements through, for bongo to replace, so a partial with one of these names cannot be called from Markdown. Call it with `{{#partial}}` instead.
