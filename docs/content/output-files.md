---
title: Output files
summary: How a .hbs file in content/ with a second extension becomes an output file, such as a sitemap, a robots.txt, or a feed.
group: Guides
order: 10
---

A `.hbs` file in `content/` is an output file, not a page, when its second extension is a file type with a known content type, other than `.html`. Examples are `.xml`, `.txt`, `.json`, `.svg`, and `.webmanifest`. Use output files for sitemaps, `robots.txt` files, and feeds.

## Paths

bongo writes an output file to its own path, without the `.hbs`:

| File | Output |
| --- | --- |
| `content/sitemap.xml.hbs` | `/sitemap.xml` |
| `content/blog/index.xml.hbs` | `/blog/index.xml` |
| `content/robots.txt.hbs` | `/robots.txt` |

`content/v1.2.hbs` stays a page, because `.2` is not a file type.

## Values

An output file compiles with the same values as [`.hbs` content](/content/#hbs-content): `$site`, `$page`, `$pages`, `$section`, `$tags`, `$data`, `$utils`, and its own frontmatter as `params`.

## How it differs from a page

- It gets no layout. bongo writes it as it renders. bongo does not replace `<bongo:*>` elements or content images in it, adds no dev reload script, and never minifies it.
- It is not in `$pages`, `$section`, or `$tags`. Thus a sitemap or a feed never lists itself.
- Its frontmatter cannot set `url`. To change its path, rename the file.
- `bongo dev` serves it with the content type of its extension, such as `text/xml`. bongo renders it again after every change to a page, because it can read every page.
- It renders after every page, so the entries of `$pages` have the `alternates` of each page. See the [llms.txt guide](/llms-txt/).

[`$hooks.transform`](/hooks/) gets each output file, with `ctx.kind` set to `'output'`.

## Whitespace

As in all templates, tempura removes the line break just before each `{{ }}` tag and at the end of the file. Put a tag at the end of its line to keep the output tidy.

The output starts after the `---` line that closes the frontmatter, so an XML file can start with `<?xml`.

## Sitemap

A sitemap, in `content/sitemap.xml.hbs`:

```hbs [content/sitemap.xml.hbs]
<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{{#each $pages as page}}
	<url>
		<loc>{{ page.url }}</loc>
{{#if page.params.lastmod}}
		<lastmod>{{ page.params.lastmod }}</lastmod>
{{/if}}
	</url>
{{/each}}
</urlset>
```

## robots.txt

A `robots.txt`, in `content/robots.txt.hbs`:

```hbs [content/robots.txt.hbs]
User-agent: *
Allow: /
Sitemap: {{ $site.url }}sitemap.xml
```

## Feeds

A feed is an output file whose frontmatter has `format: rss` or `format: atom`. The [@bongo/feed](/feed/) plugin turns its `<feed:*>` elements into RSS or Atom. It also turns each `<feed:link>` in your layouts into a link to the feed.

```hbs [content/blog/index.xml.hbs]
---
format: rss
title: My blog
---
<feed:channel>
{{#each $section.filter(post => post.params.date) as post}}
<feed:item href="{{ post.path }}" title="{{ post.title }}" date="{{ post.params.date }}" summary="{{ post.summary }}" />
{{/each}}
</feed:channel>
```

## JSON

`content/feed.json.hbs` also works, but it is not recommended. `{{ }}` escapes text for HTML, not for JSON, so the output is easily invalid. For JSON, use a [data module](/data-modules/).
