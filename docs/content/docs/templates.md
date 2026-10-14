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

Layouts, partials, `.hbs` content, and output files get these values. The examples show what they hold while bongo renders this post, on a site whose `$site.url` is `https://example.com/`:

```md [content/blog/hello.md]
---
title: Hello, world
summary: My first post.
date: 2024-05-01
tags: [js, css]
draft: false
---

Static sites with a good beat.

## Why bongo

It is fast.

### Setup

Run it.
```

The site also has `content/index.md`, `content/about.md`, `content/blog/index.md`, `content/blog/second.md`, and `data/site.yaml`.

### `$page`

The page that renders:

```ts
{
	path: '/blog/hello/',
	url: 'https://example.com/blog/hello/',
	title: 'Hello, world',
	summary: 'My first post.',
	section: 'blog',
	tags: ['js', 'css'],
	params: {
		title: 'Hello, world',
		summary: 'My first post.',
		date: '2024-05-01',
		tags: ['js', 'css'],
		draft: false,
	},
	headings: [
		{ level: 2, id: 'why-bongo', text: 'Why bongo', html: 'Why bongo' },
		{ level: 3, id: 'setup', text: 'Setup', html: 'Setup' },
	],
	content: '<p>Static sites with a good beat.</p>\n<h2 id="why-bongo">…',
}
```

| Field | What it holds |
| --- | --- |
| `path` | The URL path of the page. On a site under a subpath, it starts with that subpath. See [Page URLs](/docs/content/#page-urls). |
| `url` | The absolute URL of the page. |
| `title` | The `title` frontmatter, as text. `''` when the page has none. |
| `summary` | The `summary` frontmatter, as text. `''` when the page has none. |
| `section` | The folder of the content file inside `content/`, such as `blog` or `docs/guides`. `''` for a file at the root of `content/`. See [Sections](/docs/content/#sections). |
| `tags` | The `tags` frontmatter, as a list. The frontmatter can be a list or a comma-separated string. See [Tags](/docs/content/#tags). |
| `params` | All the frontmatter, with typed values. See [Frontmatter](/docs/frontmatter/). |
| `headings` | The headings that the page's [loader](/docs/loaders/) reports, each with its `level`, `id`, plain `text`, and inner `html`. [@bongo/markdown](/docs/markdown/#headings) reports every Markdown heading. `.html` and `.hbs` content has none. |
| `content` | The body of the page, as HTML. Print it with `{{{ $page.content }}}`. While the page's own `.hbs` body compiles, `content` is empty. |

A table of contents from `headings`:

```hbs
<ol>
{{#each $page.headings.filter(h => h.level === 2) as h}}
	<li><a href="#{{ h.id }}">{{{ h.html }}}</a></li>
{{/each}}
</ol>
```

### `$pages`

Every page of the build, sorted by `path`. Each entry has the fields of `$page`, except `content`. Output files and data modules are not in it.

```ts
[
	{
		path: '/',
		url: 'https://example.com/',
		title: 'Home',
		summary: '',
		section: '',
		tags: [],
		params: { title: 'Home' },
		headings: [{ level: 1, id: 'home', text: 'Home', html: 'Home' }],
	},
	{ path: '/about/', title: 'About', section: '', … },
	{ path: '/blog/', title: 'Blog', section: 'blog', … },
	{ path: '/blog/hello/', title: 'Hello, world', section: 'blog', … },
	{ path: '/blog/second/', title: 'Second post', section: 'blog', … },
]
```

### `$section`

The pages in the same section as the current page, sorted by `path`, with the same fields as `$pages`. The section includes its index page and the current page. For `content/blog/hello.md`:

```ts
[
	{ path: '/blog/', title: 'Blog', section: 'blog', … },
	{ path: '/blog/hello/', title: 'Hello, world', section: 'blog', … },
	{ path: '/blog/second/', title: 'Second post', section: 'blog', … },
]
```

A page at the root of `content/` gets the other root pages: `/` and `/about/` here. The posts of a blog, newest first:

```hbs
{{#var posts = $section.filter(post => post.params.date)}}
{{#var newest = posts.toSorted((a, b) => b.params.date > a.params.date ? 1 : -1)}}
{{#each newest as post}}
	<a href="{{ post.path }}">{{ post.title }}</a>
{{/each}}
```

### `$tags`

One entry for each tag, with the pages that have it. The tags come in the order in which they first appear in `$pages`. The pages of each tag are sorted by `path`.

```ts
[
	{
		tag: 'js',
		pages: [{ path: '/blog/hello/', title: 'Hello, world', … }],
	},
	{
		tag: 'css',
		pages: [
			{ path: '/blog/hello/', title: 'Hello, world', … },
			{ path: '/blog/second/', title: 'Second post', … },
		],
	},
]
```

### `$site`

The `$site` field of the [config](/docs/config/#site). `description` is `''` and `menu` is `{}` when the config does not set them.

```ts
{
	url: 'https://example.com/',
	lang: 'en',
	title: 'My Site',
	description: 'A site built with bongo.',
	menu: {},
}
```

### `$data`

The files in `data/`, keyed by their paths without the extension. See [Data](/docs/data/).

```yaml [data/site.yaml]
author: Luke
links: [github, npm]
```

```ts
{ site: { author: 'Luke', links: ['github', 'npm'] } }
```

### `$utils`

The helper functions, such as `{{ $utils.date.format($page.params.date, { dateStyle: 'long' }) }}`. See [Utilities](/docs/utilities/).

### `$assets`

An object with one method, `load(filename, encoding?)`. It reads a file from `assets/` and returns a promise of its text, or of a `Buffer` when you give no `encoding`. A missing file fails the build. Inline an icon:

```hbs
{{{ await $assets.load('icons/star.svg', 'utf8') }}}
```

### `params`

In [`.hbs` content](/docs/content/#hbs-content) and [output files](/docs/output-files/), `params` is a short name for `$page.params`, such as `{{ params.date }}`.

### Where the values are

[`.hbs` content](/docs/content/#hbs-content) gets the same values as layouts. [Output files](/docs/output-files/) get them too. [Partials](/docs/partials/#values) get the `$page`, `$pages`, `$section`, and `$tags` of the page that renders them.

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
