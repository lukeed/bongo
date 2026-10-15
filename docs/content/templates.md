---
title: Templates
summary: Template syntax, how bongo finds the layouts of a page, the variables that templates read and declare, and the special elements that add scripts, styles, and assets.
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
| `{{#if test}} … {{#elif other}} … {{#else}} … {{/if}}` | Print the first block whose test is true. |
| `{{#each list as item}} … {{/each}}` | Print the block once for each item. `as (item, i)` also names the index. |
| `{{#var name = value}}` | Declare a variable. See [Your own variables](#your-own-variables). |
| `{{#expect a, b}}` | Declare the arguments that a partial reads. |
| `{{#partial src="name"}}` | Call a partial. See [Partials](/partials/). |

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

Templates read the build through reserved variables: `$site`, `$page`, `$pages`, `$section`, `$tags`, `$data`, `$utils`, and `$assets`. `{{ $page.title }}` prints the title of the current page, and `{{#each $section as post}}` loops over the pages of its folder. See [Variables](/variables/) for what each one holds, with examples.

### Your own variables

`{{#var name = value}}` declares a variable. The value is a JavaScript expression. The variable holds the value from that tag to the end of the file. Use a variable to calculate a value once and use it more than once, or to give a long expression a short name:

```hbs [layouts/blog/single.hbs]
{{#var date = $page.params.date}}
{{#var related = $section.filter(post => post.path !== $page.path).slice(0, 3)}}
<article>
	<h1>{{ $page.title }}</h1>
	{{#if date}}
	<time datetime="{{ date }}">{{ $utils.date.format(date, { dateStyle: 'long' }) }}</time>
	{{/if}}
	{{{ $page.content }}}
	{{#if related.length}}
	<h2>More posts</h2>
	<ul>
		{{#each related as (post, i)}}
		<li>{{ i + 1 }}. <a href="{{ post.path }}">{{ post.title }}</a></li>
		{{/each}}
	</ul>
	{{/if}}
</article>
```

- To change a variable, declare it again: `{{#var count = count + 1}}`.
- `{{#each list as post}}` declares `post` for each item. `{{#each list as (post, i)}}` also declares the index, `i`, which starts at 0.
- Each template has its own variables. A partial does not see the variables of the layout that calls it. Give them to the partial as arguments, such as `{{#partial src="byline" date=date}}`, and declare them in the partial with `{{#expect date}}`. See [Partials](/partials/#values).

Your own values can also come from:

- the frontmatter of a page, as `$page.params`. See [Frontmatter](/frontmatter/).
- the files in `data/`, as `$data`. See [Data](/data/).
- your own helper functions, as `$utils`. See [Utilities](/utilities/#your-own-helpers).

## Special elements

bongo has its own elements for the scripts, styles, and other files of `assets/`. Put them in a layout or a partial. After the layouts render, bongo builds each file, gives it a content-hashed name, and replaces the element with the HTML that loads the file:

```hbs [layouts/html.hbs]
<!doctype html>
<html lang="{{ $site.lang }}">
<head>
	<meta charset="utf-8"/>
	<title>{{ $page.title }}</title>
	<bongo:asset preload src="fonts/inter.woff2" />
	<link rel="icon" href="<bongo:asset src='img/favicon.svg' />"/>
	<bongo:style src="app.css" />
</head>
<body>
	{{{ $page.content }}}
	<bongo:client transitions />
	<bongo:script src="main.ts" />
</body>
</html>
```

| Element | Use it to |
| --- | --- |
| `<bongo:style>` | build a stylesheet with LightningCSS, as a `<link>` or an inline `<style>`. See [CSS](/css/). |
| `<bongo:script>` | bundle a script with Rolldown, as a module `<script>` or an inline script. |
| `<bongo:asset>` | publish any file, such as a font or an icon, as a URL or a `<link rel="preload">`. |
| `<bongo:client>` | add the [client runtime](/client-runtime/), for client-side navigation and view transitions. |
| `<bongo:image>` | resize and convert an image, as a `<picture>` with a `srcset`. See [Images](/images/). |
| `<bongo:alternate>` | link another version of the page, such as a Markdown copy that bongo writes. See [Alternates](/alternates/). |

bongo publishes only the files that these elements and your CSS use. A `src` that does not exist fails the build. See [Special elements](/special-elements/) for each attribute and the HTML that each element becomes, and [TypeScript](/typescript/) for type checks of these elements.
