---
title: Frontmatter
summary: The YAML subset that bongo reads at the top of content files, how it types values, and how to update a site from string-only frontmatter.
group: Guides
order: 2
---

A content file can start with a YAML block between two `---` lines. Its values become `$page.params`.

```yaml
---
title: Hello, world
date: 2024-05-01
draft: false
weight: 3
tags: [js, css]
authors:
  - name: Luke
    url: https://lukeed.com
cover:
  src: hero.webp
  alt: "Issue #1"
---
```

## Page values

bongo reads three keys into fields of `$page`:

- `title` becomes `$page.title`.
- `summary` becomes `$page.summary`.
- `tags` becomes `$page.tags`. It takes a list or a comma-separated string. See [Tags](/docs/content/#tags).

`$page.title` and `$page.summary` are always text, so `title: 2024` gives `"2024"`. All keys, these three included, stay in `$page.params` with their typed values.

`url` sets a custom path for the page. See [Custom URLs](/docs/content/#custom-urls).

## The YAML subset

bongo reads a small subset of YAML:

- Values are typed. `42` and `-1.5` are numbers, `true` and `false` are booleans, and `null`, `~`, and an empty value are `null`. Everything else is a string.
- Dates stay strings, as written. Text like `1.0.0`, and numbers with a leading zero like `007`, also stay strings.
- A string can be plain, `'single-quoted'` (write `''` for a quote), or `"double-quoted"` with backslash escapes like `\n` and `\"`. A quoted value is always a string.
- Lists are inline, `[a, b]`, or one `- item` per line. Maps are inline, `{a: 1}`, or nested by indentation. Indent with spaces, not tabs.
- `#` after a space starts a comment.
- A plain value runs from the first `: ` to the end of the line, so `summary: Install with: brew` works. A value that only starts like a quoted string, list, or map, such as `[WIP] Notes`, is plain text.
- Not supported: multi-line strings (`|`, `>`, or a value that continues on the next line), anchors, aliases, and tags. Inline lists and maps must fit on one line.

The same subset applies to YAML files in `data/`. See [Data](/docs/data/).

## Errors

An error names the file and the line:

```
content/blog/post.md: Invalid frontmatter: duplicate key "title" at line 3
```

## Where it applies

bongo reads the frontmatter of `.html` and `.hbs` content. `@bongo/markdown` reads the frontmatter of `.md` files. Your own loader can parse a frontmatter block with `utils.frontmatter(content)`. It returns `{ offset, value }`, where `offset` is where the body starts. See [Loader utilities](/docs/loaders/#loader-utilities).

An [output file](/docs/output-files/) also has frontmatter, but it cannot set `url`. A feed sets `format: rss` or `format: atom` in its frontmatter. See [@bongo/feed](/docs/feed/).

## Migrate from string-only frontmatter

Older versions of bongo read every value as a string, and split each line on its first `:`. To update a site:

- `hidden: true` is now the boolean `true`, not `'true'`. Compare with `=== true`.
- `stars: 120` is now the number `120`. In templates, `+` now adds instead of joins.
- `forks: 0` is now the number `0`, which `{{#if $page.params.forks}}` treats as false. To show zeros, test `{{#if $page.params.forks != null}}`.
- `version: 1.0` is now the number `1`. Quote values that must stay text: `version: "1.0"`.
- `title: Issue #42` is now `Issue`, because ` #` starts a comment. Quote it: `title: "Issue #42"`.
- `note:` with no value is now `null`, not `''`.
- A line that is not `key: value` is now an error, and so is a duplicate key.
- `key:` followed by indented lines is now a nested map or list.
