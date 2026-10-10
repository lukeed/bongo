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
```

### Minify

`--minify` minifies every JavaScript bundle with Rolldown and every stylesheet with LightningCSS, including inline ones. It also minifies the HTML pages with [tdewolff/minify](https://github.com/tdewolff/minify) when its `minify` CLI is on your `$PATH`. If the CLI is missing, the build still succeeds: it prints one notice and leaves the HTML as it is. Without `--minify`, nothing is minified.

## How It Works

When you run `bongo build`:

1. Config is loaded from `bongo.config.{ts,mjs,cjs,js}` by walking upward from `cwd`. Bun and Deno import TypeScript config files natively. Node bundles the config through Rolldown to a temp `.mjs` and dynamic-imports it.
2. Layouts and partials are collected from `layouts/` and `partials/`. Handlebars files (`.hbs`) are compiled with tempura. JavaScript and TypeScript partials are loaded as modules.
3. Content files are passed through registered loaders, then rendered through the matching layout chain.
4. Rendered HTML is scanned for `<bongo:style>`, `<bongo:script>`, and `<bongo:client>` elements. Assets are registered and replaced with placeholder tokens.
5. Asset groups are flushed. JavaScript goes through Rolldown; CSS goes through LightningCSS. Output filenames include content hashes.
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
- `plugins` — array of partial config objects, merged in order.

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
- `utils.frontmatter(content)` — parse YAML-like frontmatter delimited by `---`.

## publicPath

The `publicPath` prefix applied to external asset URLs is derived from `$site.url`:

- Root-served site (`https://example.com`) -> `publicPath = /`
- Subpath-served site (`https://example.com/blog/`) -> `publicPath = /blog/`

No manual configuration is required.

## Templates

Templates use [tempura](https://github.com/lukeed/tempura) syntax. Asset entrypoints are declared with `<bongo:style>`, `<bongo:script>`, `<bongo:client>`, and `<bongo:asset>` custom elements.

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

`<bongo:client>` bundles bongo's browser runtime and emits a module script that calls `client(...)`, plus the hidden `aria-live` region used to announce page-title changes:

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

Content files ending in `.hbs` are tempura-compiled with the same context as layouts: `$site`, `$page`, `$pages`, `$section`, `$tags`, `$assets`, `$utils`, plus `params` as an alias for `$page.params`.

The current page's own `$page.content` is empty while its body is compiling. It is the value produced by that compile.

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
<div id="bongo:live" role="status" aria-live="polite" style="...visually-hidden..."></div>
<script type="module">
  import { client } from "/client.D59fAaym.js";
  client({ transitions: true });
</script>
```

The runtime updates `#bongo:live` with the new page title on navigation. If the element is missing, announcements are skipped silently.

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
| `prefetch` | `boolean \| 'hover' \| 'tap'` | `false` | Prefetch same-origin links into the in-memory HTML cache. `true` / `'hover'` fires after hover settles, or immediately on touch. `'tap'` fires on `mousedown` / `touchstart`. Opt a link out with `prefetch:disable`. |

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

- `<bongo:client>`, `<bongo:script>`, and `<bongo:style>` intrinsic elements.
- `transition:name` and `transition:animate` on every HTML element.
- `transition:disable` and `prefetch:disable` on anchors.

Or reference the types directly:

```ts
/// <reference types="bongo/jsx" />
```
