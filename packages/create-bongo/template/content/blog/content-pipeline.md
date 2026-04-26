---
title: The Content Pipeline
date: 2026-03-15
summary: How bongo's $pages, $section, and $tags registries are built, and how to use them effectively in layouts.
tags: ssg, architecture, tempura
---

# The Content Pipeline

After walk 1 completes, bongo has a flat list of compiled pages. Before walk 2 begins, it assembles three registries that layouts can query. Understanding these registries is the key to building index pages, tag clouds, and related-post lists.

## $pages

`$pages` is every page on the site, indexed by path. In a layout you can iterate the full list:

```hbs
{{#each $pages as (p)}}
  <a href="{{ p.path }}">{{ p.title }}</a>
{{/each}}
```

This is useful for site maps or global navigation, but usually too broad for section-level features.

## $section

`$section` is a filtered subset of `$pages` — only pages whose path shares a directory prefix with the current page. For a page at `/blog/my-post/`, `$section` contains every page under `/blog/`.

This is the natural way to build a blog index. The layout iterates `$section`, skips the index page itself, and renders a list of posts:

```hbs
{{#each $section as (p)}}
  {{#if p.path !== $page.path}}
    <h2><a href="{{ p.path }}">{{ p.title }}</a></h2>
  {{/if}}
{{/each}}
```

`$section` arrives in path-ascending order. To sort by date, pass it through a `$utils` helper:

```hbs
{{#var posts = $utils.sortByDate($section)}}
```

## $tags

`$tags` is a map of tag name to array of pages. If any page has `tags: foo, bar` in its frontmatter, `$tags.foo` and `$tags.bar` will each contain that page.

Tag values in frontmatter are CSV strings — bongo parses them into a `string[]` on the page object.

## The postmeta pattern

Because `$page`, `$section`, and `$tags` are only available in layouts (not `.hbs` content bodies), meta like "related posts" must live in a layout or partial. The `postmeta` partial is a good place to put reusable post header markup:

```hbs
{{#partial src="postmeta" date=$page.params.date tags=$page.tags}}
```

This keeps the single-post layout clean and the meta rendering consistent across the site.
