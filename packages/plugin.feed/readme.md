# @bongo/feed

> RSS and Atom feeds for [bongo](https://github.com/lukeed/bongo).

## Install

```sh
bun add -d @bongo/feed
```

## Usage

Add the plugin to `bongo.config.ts`:

```ts
import { feed } from '@bongo/feed';

export default {
	$site: { url: 'https://example.com/', title: 'My Site', lang: 'en' },
	plugins: [feed()],
};
```

A feed is an [output file](../bongo/readme.md#output-files) whose frontmatter has `format: rss` or `format: atom`. For example, `content/blog/feed.xml.hbs`, which bongo writes to `/blog/feed.xml`:

```hbs
---
format: rss
title: Blog
description: Latest posts
---
{{#var posts = $section.filter(p => p.params.date).toSorted((a, b) => String(b.params.date).localeCompare(String(a.params.date)))}}
<feed:channel>
{{#each posts as post}}
<feed:item href="{{ post.path }}" title="{{ post.title }}" date="{{ post.params.date }}" summary="{{ post.summary }}" />
{{/each}}
</feed:channel>
```

Then put a `<feed:link>` in the `<head>` of your layout:

```hbs
<feed:link path="/blog/feed.xml" />
```

Each page gets a link to the feed:

```html
<link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/feed.xml" />
```

## How it works

bongo renders the feed file like any other output file, so `{{ }}` fills in the attributes of each `<feed:item>`. The plugin then replaces the whole file with RSS 2.0 or Atom 1.0, made from the frontmatter and the `<feed:item>` elements in `<feed:channel>`. It drops all text outside `<feed:channel>`.

Write attribute values with `{{ }}`, not `{{{ }}}`. `{{ }}` escapes `&`, `<`, and `"`, and the plugin decodes each value once before it writes the XML, so each character arrives as it is in your content. With `{{{ }}}`, a value that has a `"` breaks the element.

`<feed:link>` reads the frontmatter of the feed at `path` to get its type and title.

Change `format: rss` to `format: atom` and both the feed and the type of every `<feed:link>` to it change. You do not edit your layouts or the `<feed:channel>` block.

## Elements

### `<feed:link path="…" />`

Use it in a layout or a page.

| Attribute | Required | Notes |
| --- | --- | --- |
| `path` | yes | The URL path of the feed, such as `/blog/feed.xml`. It must be an output file with `format: rss` or `format: atom`. For a site in a subfolder of `$site.url`, the link gets the subfolder, as asset links do. |
| `title` | no | The link title. Defaults to the `title` of the feed. |

### `<feed:channel>…</feed:channel>`

It holds the `<feed:item>` elements. The frontmatter of the feed file sets the rest:

| Frontmatter | Required | Notes |
| --- | --- | --- |
| `format` | yes | `rss` or `atom`. |
| `title` | yes | The feed title. |
| `description` | no | RSS `<description>`. Atom uses it as `<subtitle>` when there is no `subtitle`. |
| `subtitle` | no | Atom `<subtitle>`. |
| `language` | no | Defaults to `$site.lang`. |
| `copyright` | no | RSS `<copyright>`, Atom `<rights>`. |
| `link` | no | The page that the feed is for, such as `/blog/`, as a path or a URL. RSS `<link>`, Atom `<link rel="alternate">`. Defaults to `$site.url`. |
| `author` | no | Atom `<author>` of the feed, for entries that do not name their own. Defaults to `$site.title`. |

The URL of the feed comes from its path and `$site.url`. The latest item `date` becomes RSS `<lastBuildDate>` and Atom `<updated>`. An empty Atom feed gets the build time, because Atom requires `<updated>`.

### `<feed:item … />`

Each one becomes an `<item>` in RSS or an `<entry>` in Atom, in the same order.

| Attribute | Required | Notes |
| --- | --- | --- |
| `href` | yes | The URL of the post. A path resolves under `$site.url`. |
| `title` | yes | The post title. |
| `date` | yes | A date that JavaScript can parse, such as `2025-01-15` or `2025-01-15T10:00:00Z`. |
| `summary` | no | RSS `<description>`, Atom `<summary>`. |
| `content` | no | HTML. RSS `<content:encoded>`, Atom `<content type="html">`. |
| `id` | no | RSS `<guid isPermaLink="false">`, Atom `<id>`. Defaults to the URL. |
| `author` | no | A name. RSS `<dc:creator>`, because RSS `<author>` must be an email address. Atom `<author><name>`. |
| `tags` | no | Comma-separated. Each one becomes a `<category>`. |

## Errors

The build fails, and the error names the file, when:

- an element has an attribute that it does not support, or misses one that it needs,
- a `<feed:item>` has a `date` that is not a valid date,
- a feed has no `<feed:channel>` or no `title`,
- an output file has a `<feed:channel>` but no `format: rss` or `format: atom`,
- the `path` of a `<feed:link>` is not an output file, or that file has no `format: rss` or `format: atom`.

## License

MIT © [Luke Edwards](https://lukeed.com)
