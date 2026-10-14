---
title: Content
summary: How bongo turns the files in content/ into pages, how page URLs, sections, and tags work, and how .hbs content compiles.
group: Guides
order: 1
---

Each file in `content/` becomes a page, an output file, a data module, or a copied file. The path of a file in `content/` sets its URL.

## File types

| File | Result |
| --- | --- |
| `.md` | A page, made by the `.md` loader of [@bongo/markdown](/docs/markdown/). |
| `.html`, `.htm` | A page. bongo uses the body as it is written. |
| `.hbs` | A page that tempura compiles. See [.hbs content](#hbs-content). |
| `.hbs` with a second extension that has a known content type, other than `.html`, such as `sitemap.xml.hbs` | An [output file](/docs/output-files/). |
| `.json.ts`, `.json.js` | A [data module](/docs/data-modules/). |
| An extension with a loader in `$loaders` | The loader chain transforms it. See [Loaders](/docs/loaders/). |
| Any other file, such as an image | bongo copies it to the same path in `public/`. |

Each content file can start with a frontmatter block. See [Frontmatter](/docs/frontmatter/).

## Page URLs

A page's URL path is its path in `content/` without the extension, with a trailing slash. An `index` file gets the path of its folder. bongo writes each page to an `index.html` file in the folder of that path.

| File | URL path | Output |
| --- | --- | --- |
| `content/index.md` | `/` | `public/index.html` |
| `content/about.md` | `/about/` | `public/about/index.html` |
| `content/blog/index.hbs` | `/blog/` | `public/blog/index.html` |
| `content/blog/post.md` | `/blog/post/` | `public/blog/post/index.html` |
| `content/404.md` | `/404/` | `public/404/index.html` |

### Custom URLs

Set `url` in the frontmatter to give a page another path. bongo adds the trailing slash and writes `index.html` in that folder. A path that ends in `.html` writes that exact file.

| Frontmatter | URL path | Output |
| --- | --- | --- |
| `url: /about-us/` | `/about-us/` | `public/about-us/index.html` |
| `url: team` | `/team/` | `public/team/index.html` |
| `url: /404.html` | `/404.html` | `public/404.html` |

A custom `url` must be a path, not a full URL. [Output files](/docs/output-files/) cannot set `url`: rename the file to change its path.

Most static hosts serve `404.html` for a path that does not exist. Give your 404 page `url: /404.html` so that the build writes that file. The [dev server](/docs/dev-server/#not-found-pages) uses `404.html` or `404/index.html` as the body of its 404 responses.

`$page.path` is the URL path, such as `/blog/post/`. `$page.url` is the absolute URL, made from `$site.url` and the path. When `$site.url` has a subpath, `$page.url` includes it. For `https://example.com/blog/`, `content/post.md` is `https://example.com/blog/post/`. See [publicPath](/docs/config/#publicpath).

## Sections

A page's section is the folder of its file, relative to `content/`:

| File | Section |
| --- | --- |
| `content/index.md` | `''`, the empty string |
| `content/blog/post.md` | `blog` |
| `content/blog/index.hbs` | `blog` |
| `content/blog/2025/post.md` | `blog/2025` |

`$page.section` holds the section. `$section` holds every page in the section of the current page, sorted by path. An index file is in the section of its own folder. Thus on a blog index, `$section` also holds the index page. The starter blog skips it:

```hbs
{{#each $section as post}}
{{#if post.path !== $page.path}}
  <a href="{{ post.path }}">{{ post.title }}</a>
{{/if}}
{{/each}}
```

## Tags

A page gets its tags from the `tags` frontmatter key. The value can be a list or a comma-separated string:

```yaml
tags: [js, css]
```

```yaml
tags: js, css
```

`$page.tags` holds the list. `$tags` holds an array of `{ tag, pages }` entries for the whole build. Use it to list the pages of each tag:

```hbs
{{#each $tags as entry}}
<h2>{{ entry.tag }}</h2>
<ul>
{{#each entry.pages as page}}
  <li><a href="{{ page.path }}">{{ page.title }}</a></li>
{{/each}}
</ul>
{{/each}}
```

## `.hbs` content

Content files that end in `.hbs` are tempura-compiled with the same context as layouts: `$site`, `$page`, `$pages`, `$section`, `$tags`, `$assets`, `$utils`, `$data`, plus `params` as an alias for `$page.params`. See [Variables](/docs/templates/#variables).

```hbs [content/archive.hbs]
---
title: Archive
summary: Every page of the site.
---
<h1>{{ params.title }}</h1>
<ul>
{{#each $pages as page}}
  <li><a href="{{ page.path }}">{{ page.title }}</a></li>
{{/each}}
</ul>
```

The current page's own `$page.content` is empty while its body compiles. It is the value that this compile produces.

Only `.hbs` content compiles as a template. bongo uses `.html` content and loader output, such as rendered Markdown, as they are. Markdown can still call partials with elements. See [Elements](/docs/markdown/#elements).

## Images in content

bongo processes each `<img>` in a page's content whose `src` is a relative path. It gives the image a `srcset`, a `width`, and a `height`. The path resolves against the URL of the page. For `content/blog/post.md`, which is served at `/blog/post/`, `hero.jpg` is `content/blog/post/hero.jpg`. See [Content images](/docs/images/#content-images).
