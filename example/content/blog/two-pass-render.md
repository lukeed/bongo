---
title: The Two-Pass Render
date: 2026-02-05
summary: How bongo's two-walk build pipeline separates content compilation from layout rendering, and what that means for template authors.
tags: architecture, ssg
---

bongo builds pages in two passes. Understanding why makes it easier to write templates that work.

## Walk 1 — content scan

The first walk scans every file in `content/`. For each file:

1. **Loaders** run in sequence. A `.md` file goes through the markdown loader and becomes HTML. A `.hbs` file is compiled by tempura.
2. **Frontmatter** is parsed into `params`.
3. **Assets** (CSS, JS) referenced in layouts are registered for bundling.

After walk 1, bongo has a flat list of pages with compiled content bodies, but it doesn't know anything about the _relationships_ between pages yet.

## Between walks — registry build

Between the two walks, bongo assembles three registries:

- `$pages` — every page on the site
- `$section` — pages that share a directory prefix with the current page
- `$tags` — pages grouped by tag

These are sorted and deduplicated. The sort is path-ascending by default, so a blog index's `$section` arrives in alphabetical order. Layouts can re-sort using a `$utils` helper.

## Walk 2 — layout render

The second walk iterates the same page list and renders each page through its layout chain. Because the registries exist now, layouts can iterate `$section` to build an index list, or `$tags` to build a tag cloud.

```hbs
{{#each $section as (p)}}
  {{#if p.path !== $page.path}}
    <a href="{{ p.path }}">{{ p.title }}</a>
  {{/if}}
{{/each}}
```

## The constraint on .hbs content

`.hbs` content bodies are compiled in walk 1, before the registries exist. That means `$page`, `$section`, `$pages`, and `$tags` are not available inside a `.hbs` content file. Only `$site`, `$utils`, and `params` are in scope.

If you need to iterate sibling pages in content, move that logic into the layout.
