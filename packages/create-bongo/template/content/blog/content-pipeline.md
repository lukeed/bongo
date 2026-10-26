---
title: The Content Pipeline
date: 2026-03-15
summary: What bongo's $pages, $section, and $tags registries hold, and how to use them in templates.
tags: ssg, architecture, tempura
---

After walk 1, bongo knows every page. Before it renders a page, it makes three registries that templates can read. With them you can build index pages, tag lists, and lists of related posts.

## $pages

`$pages` is a list of every page on the site, sorted by path. Each entry has the `path`, `title`, `summary`, `section`, `tags`, `headings`, and `params` of a page:

```hbs
{{#each $pages as page}}
  <a href="{{ page.path }}">{{ page.title }}</a>
{{/each}}
```

It is good for a site map or for global navigation, but it is often too broad for one section.

## $section

`$section` holds the pages in the same folder as the current page. For a page at `content/blog/my-post.md`, it holds every page in `content/blog/`. The index page of the folder and the current page are in it too.

Thus a blog index loops over `$section`, and skips itself:

```hbs
{{#each $section as post}}
  {{#if post.path !== $page.path}}
    <h2><a href="{{ post.path }}">{{ post.title }}</a></h2>
  {{/if}}
{{/each}}
```

`$section` is sorted by path. To sort it by date, pass it through a `$utils` helper:

```hbs
{{#var posts = $utils.sortByDate($section)}}
```

## $tags

`$tags` has one entry for each tag, as `{ tag, pages }`. The tags come in the order in which they first appear in `$pages`. In frontmatter, `tags` is a list, such as `[ssg, bun]`, or a comma-separated string, such as `ssg, bun`.

```hbs
{{#each $tags as entry}}
  <h3>{{ entry.tag }}</h3>
  <p>{{ entry.pages.length }} posts</p>
{{/each}}
```

## The postmeta pattern

Layouts, partials, and `.hbs` content can all read these values. Put markup that many pages share, such as the date and tags of a post, in a partial:

```hbs
{{#partial src="postmeta" date=$page.params.date tags=$page.tags draft=$page.draft}}
```

The single-post layout stays short, and each post shows its meta the same way.
