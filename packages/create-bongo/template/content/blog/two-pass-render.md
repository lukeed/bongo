---
title: The Two-Pass Render
date: 2026-02-05
summary: How bongo reads all content before it renders a page, and why every template can then list the other pages.
tags: architecture, ssg
---

bongo builds pages in two passes. When you know why, it is easier to write templates that list other pages.

## Walk 1: read the content

The first walk reads each file in `content/`. For each file:

1. It parses the frontmatter into `params`.
2. It runs the loaders. The Markdown loader turns a `.md` file into HTML, and gives its headings.
3. It records the page: its path, title, summary, section, tags, and headings.

After walk 1, bongo knows every page, but it has rendered no layout yet.

## Between the walks: the registries

Then bongo makes three registries from those records:

- `$pages`: every page of the site, sorted by path.
- `$section`: the pages in the same folder as the current page, its index page and the page itself included.
- `$tags`: one entry for each tag, with the pages that have it.

The sort is by path, so a blog index gets its posts in alphabetical order. A `$utils` helper can sort them again, such as by date.

## Walk 2: render

The second walk renders each page. It compiles the body of each `.hbs` content file, then renders the page through its layouts. The registries exist now, so `.hbs` content, layouts, and partials can all loop over `$section` or `$tags`:

```hbs
{{#each $utils.sortByDate($section) as post}}
  {{#if post.path !== $page.path}}
    <a href="{{ post.path }}">{{ post.title }}</a>
  {{/if}}
{{/each}}
```

One value is missing while a page renders its own body: `$page.content` is still empty, since that body is what the render makes.

## Only what changed

bongo keeps a record of the last build. A page that no change reached keeps its file from the last build, and runs no loader. A change to a page's title or tags renders again each page that lists it through `$pages`, `$section`, or `$tags`.
