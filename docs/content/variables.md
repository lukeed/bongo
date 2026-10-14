---
title: Variables
summary: The values that templates read, such as $page, $pages, and $site, with an example of what each one holds.
group: Reference
order: 2
---

Templates read the build through variables whose names start with `$`. Layouts, [`.hbs` content](/content/#hbs-content), and [output files](/output-files/) get all of them. [Partials](/partials/#values) get them for the page that renders them. [Data modules](/data-modules/) get `$site`, `$pages`, `$section`, `$tags`, `$data`, and `$utils`.

The examples on this page show what each variable holds while bongo renders this post, on a site whose `$site.url` is `https://example.com/`:

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

## `$page`

An object with data about the current page. For the example `content/blog/hello.md` file, the `$page` object holds:

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
| `path` | The URL path of the page. On a site under a subpath, it starts with that subpath. See [Page URLs](/content/#page-urls). |
| `url` | The absolute URL of the page. |
| `title` | The `title` frontmatter, as text. `''` when the page has none. |
| `summary` | The `summary` frontmatter, as text. `''` when the page has none. |
| `section` | The folder of the content file inside `content/`, such as `blog` or `docs/guides`. `''` for a file at the root of `content/`. See [Sections](/content/#sections). |
| `tags` | The `tags` frontmatter, as a list. The frontmatter can be a list or a comma-separated string. See [Tags](/content/#tags). |
| `params` | All the frontmatter, with typed values. See [Frontmatter](/frontmatter/). |
| `headings` | The headings that the page's [loader](/loaders/) reports, each with its `level`, `id`, plain `text`, and inner `html`. [@bongo/markdown](/markdown/#headings) reports every Markdown heading. `.html` and `.hbs` content has none. |
| `content` | The body of the page, as HTML. Print it with `{{{ $page.content }}}`. While the page's own `.hbs` body compiles, `content` is empty. |

A table of contents from `headings`:

```hbs
<ol>
{{#each $page.headings.filter(h => h.level === 2) as h}}
	<li><a href="#{{ h.id }}">{{{ h.html }}}</a></li>
{{/each}}
</ol>
```

## `$pages`

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

## `$section`

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

## `$tags`

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

## `$site`

The `$site` field of the [config](/config/#site). `description` is `''` and `menu` is `{}` when the config does not set them.

```ts
{
	url: 'https://example.com/',
	lang: 'en',
	title: 'My Site',
	description: 'A site built with bongo.',
	menu: {},
}
```

## `$data`

The files in `data/`, keyed by their paths without the extension. See [Data](/data/).

```yaml [data/site.yaml]
author: Luke
links: [github, npm]
```

```ts
{ site: { author: 'Luke', links: ['github', 'npm'] } }
```

## `$utils`

The helper functions, such as `{{ $utils.date.format($page.params.date, { dateStyle: 'long' }) }}`. See [Utilities](/utilities/).

## `$assets`

An object with two methods for the files of `assets/`.

`load(filename, encoding?)` reads a file from `assets/` and returns a promise of its text, or of a `Buffer` when you give no `encoding`. A missing file fails the build. Inline an icon:

```hbs
{{{ await $assets.load('icons/star.svg', 'utf8') }}}
```

`render(template, output?, options?)` draws a partial as an image, with the values of the current page, and returns a promise of the URL path of the image. Make a social card for each page:

```hbs
{{#var card = await $assets.render('og/card')}}
<meta property="og:image" content="{{ $utils.url.abs(card) }}"/>
```

See [Render dynamic images](/dynamic-images/) and [Open Graph images](/open-graph-images/).

## `params`

In [`.hbs` content](/content/#hbs-content) and [output files](/output-files/), `params` is a short name for `$page.params`, such as `{{ params.date }}`.
