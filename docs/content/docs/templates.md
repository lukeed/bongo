---
title: Templates
summary: Template syntax, how bongo finds the layouts of a page, the values that templates get, and the elements that add scripts, styles, and assets.
group: Guides
order: 3
---

Templates use [tempura](https://github.com/lukeed/tempura) syntax, a Handlebars-like syntax. Layouts, partials, `.hbs` content, and output files are all templates.

## Syntax

These are the tempura forms that these docs use:

| Syntax | Meaning |
| --- | --- |
| `{{ value }}` | Print a value, escaped for HTML. |
| `{{{ value }}}` | Print a value as it is. Use it for HTML, such as `$page.content`. |
| `{{! comment }}` | A comment. It prints nothing. |
| `{{#if test}} … {{/if}}` | Print the block when the test is true. |
| `{{#each list as item}} … {{/each}}` | Print the block once for each item. |
| `{{#var name = value}}` | Declare a variable. |
| `{{#expect a, b}}` | Declare the arguments that a partial reads. |
| `{{#partial src="name"}}` | Call a partial. See [Partials](/docs/partials/). |

Values are JavaScript expressions, so `{{ $pages.length }}` and `{{#each $section.filter(post => post.params.date) as post}}` work. See the [tempura docs](https://github.com/lukeed/tempura) for the full syntax.

tempura removes the line break just before each `{{ }}` tag and at the end of the file. Put a tag at the end of its line to keep the output tidy.

## Layouts

A layout is a `.hbs` file in `layouts/`. It wraps the content of a page. `{{{ $page.content }}}` prints the page body.

```hbs [layouts/html.hbs]
<!doctype html>
<html lang="{{ $site.lang }}">
<head>
  <meta charset="utf-8"/>
  <title>{{ $page.title }} — {{ $site.title }}</title>
  <meta name="description" content="{{ $page.summary }}"/>
</head>
<body>
  {{{ $page.content }}}
</body>
</html>
```

### Find the layout

For each page, bongo uses the first layout that exists in a fixed order. It looks in the folder of `layouts/` that matches the page's folder first, then in each parent folder, then in `layouts/` itself. For `content/blog/2025/post.md`, the order is:

1. `layouts/blog/2025/post.hbs`
2. `layouts/blog/2025/single.hbs`
3. `layouts/blog/2025/index.hbs`
4. `layouts/blog/2025/html.hbs`
5. `layouts/blog/post.hbs`
6. `layouts/blog/single.hbs`
7. `layouts/blog/index.hbs`
8. `layouts/blog/html.hbs`
9. `layouts/post.hbs`
10. `layouts/single.hbs`
11. `layouts/index.hbs`
12. `layouts/html.hbs`

A page uses the `index.hbs` of its folder when there is no `single.hbs`, so one `index.hbs` can serve a whole folder.

For an index page, bongo looks for `index.hbs` in place of the file name and `single.hbs`. For `content/blog/index.md`, the order is:

1. `layouts/blog/index.hbs`
2. `layouts/blog/html.hbs`
3. `layouts/index.hbs`
4. `layouts/html.hbs`

A page in the root of `content/` uses only the root of `layouts/`. For `content/about.md`, the order is `layouts/about.hbs`, `layouts/single.hbs`, `layouts/index.hbs`, then `layouts/html.hbs`.

### Layout chain

When the first layout is not an `html.hbs`, bongo renders the page through it, then through the nearest `html.hbs`. The output of the first layout becomes `$page.content` in the `html.hbs`. Thus a page renders through one or two layouts.

The starter site uses this chain for its posts. `layouts/blog/single.hbs` wraps each post, and `layouts/html.hbs` wraps the result:

```hbs [layouts/blog/single.hbs]
<article class="post">
	<header>
		<h1>{{ $page.title }}</h1>
		{{#partial src="postmeta" date=$page.params.date tags=$page.tags}}
	</header>
	<div class="post-body">
		{{{ $page.content }}}
	</div>
</article>
```

When bongo finds no `html.hbs` for a page, the build fails with `Missing "html.hbs" template`.

## Variables

Templates read the build through variables, such as `$site`, `$page`, `$pages`, `$section`, `$tags`, `$data`, `$utils`, and `$assets`. `{{ $page.title }}` prints the title of the current page, and `{{#each $section as post}}` loops over the pages of its folder. See [Variables](/docs/variables/) for what each one holds, with examples.

## Asset elements

You declare asset entry points with custom elements: `<bongo:style>`, `<bongo:script>`, `<bongo:client>`, `<bongo:asset>`, and `<bongo:image>`. bongo replaces them after the layouts render, and gives each built file a content-hashed name.

```hbs [layouts/html.hbs]
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

A `src` that does not exist fails the build. The error shows the element, and the content file and layouts that rendered it.

For type checks of these elements in TypeScript, see [TypeScript](/docs/typescript/).

### `<bongo:style>`

Builds a stylesheet with LightningCSS. See [CSS](/docs/css/).

- `src="..."` — the path, relative to `assets/`.
- `inline` — splice the built CSS directly into a `<style>` block. Omit it for an external stylesheet link.
- `global` — turn off the CSS modules auto-detection on `*.module.css` sources.

### `<bongo:script>`

Bundles a script with Rolldown.

- `src="..."` — the path, relative to `assets/`.
- `inline` — splice the built JavaScript directly into a `<script>` block.
- `async` — add the `async` attribute to an external script.
- `defer` — add the `defer` attribute for CJS output. The browser defers ESM modules.
- `format="esm"|"cjs"` — the output module format. Defaults to `esm`.
- `target="..."` — a browserslist target string. It replaces [`$build.target`](/docs/config/#build-targets) for this script.

### `<bongo:asset>`

Publishes any file from `assets/`, such as a font, an image, or an icon, under a content-hashed name. It goes through the same pipeline as the files that CSS references with `url()`: a file that both use gets one copy and one URL. Thus it is the way to preload a font that your CSS loads.

```hbs
{{! Preload: emits <link rel="preload" href="/inter.3f9a1c2e.woff2" as="font" type="font/woff2" crossorigin/> }}
<bongo:asset preload src="fonts/inter.woff2" />

{{! Plain: becomes the bare URL, so it works inside attributes }}
<link rel="icon" href="<bongo:asset src='img/favicon.png' />"/>
<img src="<bongo:asset src=img/hero.webp />" alt="…"/>
```

Without `preload`, bongo replaces the element with the file's public URL and nothing else. Inside an attribute, give `<bongo:asset>` its own attributes in single quotes or without quotes, so that they do not end the outer attribute. The URL is percent-encoded, so it is safe in any attribute.

With `preload`, bongo emits a `<link rel="preload">` and infers its attributes from the file extension:

| Files | `as` | `type` | `crossorigin` |
| --- | --- | --- | --- |
| `.woff2`, `.woff`, `.ttf`, `.otf` | `font` | `font/woff2`, … | yes, as preload requires for fonts |
| images, such as `.png`, `.jpg`, `.svg`, `.webp`, `.avif` | `image` | `image/png`, … | no |
| `.css` | `style` | `text/css` | no |
| `.js`, `.mjs` | `script` | `text/javascript` | no |
| anything else, such as `.json` or `.wasm` | `fetch` | when known | yes |

Attributes:

- `src="..."` — the path, relative to `assets/`.
- `preload` — emit a `<link rel="preload">` in place of the bare URL.
- `as="..."`, `type="..."` — override the inferred values. `type=false` leaves `type` out.
- `crossorigin` or `crossorigin="use-credentials"` — override the inferred value. `crossorigin=false` leaves it out.
- `media="..."`, `fetchpriority="high|low|auto"` — copied onto the `<link>`.

### `<bongo:client>`

Bundles bongo's browser runtime and emits a module script that calls `client(...)`. It emits only that script, so you can put it anywhere in `<head>` or `<body>`:

```hbs
<bongo:client />
<bongo:client transitions />
<bongo:client transitions="slide" />
```

Multiple `<bongo:client>` tags on a page share one bundled runtime. See [Client runtime](/docs/client-runtime/).

### `<bongo:image>`

Resizes and converts an image, and emits a `<picture>` with a `srcset` for each format:

```hbs
<bongo:image src="img/hero.jpg" alt="A hero" sizes="(min-width: 800px) 720px, 100vw" />
```

See [The image element](/docs/images/#the-image-element).
