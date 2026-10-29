---
title: Translations
summary: How to build a site in more than one language, with a translation of each page, hreflang links, the lang of each page, translated layout text, and a sitemap.
group: Guides
order: 15
---

bongo has no language setting. A translation is a page of its own, and frontmatter tells the layout which pages are versions of one page. The layout then finds them in `$pages`.

## Write a page for each language

Put the pages of each other language in a folder, such as `content/fr/`. Give each translated page its `lang`, and a `key` that all versions of the page share. The key lets each language have its own slug:

```md [content/about.md]
---
title: About
key: about
---
```

```md [content/fr/a-propos.md]
---
title: À propos
lang: fr
key: about
---
```

A page without `lang` is in the language of [`$site.lang`](/config/). A page without `key` has no translations.

## Link the versions of a page

Search engines find the other languages of a page through `<link rel="alternate" hreflang>` in its `<head>`. The layout finds every page with the same `key`:

```hbs [layouts/html.hbs]
{{#var lang = $page.params.lang || $site.lang}}
{{#var versions = $page.params.key ? $pages.filter(p => p.params.key === $page.params.key) : []}}
<html lang="{{ lang }}">
<head>
	<title>{{ $page.title }}</title>
	{{#each versions as v}}
	<link rel="alternate" hreflang="{{ v.params.lang || $site.lang }}" href="{{ v.url }}"/>
	{{/each}}
	{{#if versions.length > 1}}
	<link rel="alternate" hreflang="x-default" href="{{ (versions.find(v => !v.params.lang || v.params.lang === $site.lang) || versions[0]).url }}"/>
	{{/if}}
</head>
```

On `/fr/a-propos/`, and on `/about/` too, this writes:

```html
<html lang="fr">
<link rel="alternate" hreflang="en" href="https://example.com/about/"/>
<link rel="alternate" hreflang="fr" href="https://example.com/fr/a-propos/"/>
<link rel="alternate" hreflang="x-default" href="https://example.com/about/"/>
```

- Each page lists all its versions, itself included, as search engines ask.
- `v.url` is a full URL, which hreflang links need.
- `x-default` names the version for other languages: the one in `$site.lang`.
- `<html lang>` gives each page its own language, for screen readers and browsers.

These are plain `<link>` elements. [`<bongo:alternate>`](/alternates/) is for versions that bongo writes, such as a [Markdown copy](/markdown-copies/).

## Translate the text of the layout

Put the text of your layouts in [`data/`](/data/), with one entry for each language:

```json [data/i18n.json]
{
	"en": { "toc": "On this page", "more": "More pages" },
	"fr": { "toc": "Sur cette page", "more": "Autres pages" }
}
```

```hbs [layouts/html.hbs]
{{#var text = $data.i18n[lang]}}
<p>{{ text.toc }}</p>
```

## List the pages of one language

`$pages` holds every page, in every language. Filter it by `lang` for a menu or a list of posts:

```hbs
{{#var others = $pages.filter(p => (p.params.lang || $site.lang) === lang && p.path !== $page.path)}}
<h2>{{ text.more }}</h2>
<ul>{{#each others as p}}<li><a href="{{ p.path }}">{{ p.title }}</a></li>{{/each}}</ul>
```

## Add the versions to the sitemap

A [sitemap](/output-files/#sitemap) can list the versions of each page too, with `xhtml:link`:

```hbs [content/sitemap.xml.hbs]
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
{{#each $pages as page}}
<url><loc>{{ page.url }}</loc>{{#each page.params.key ? $pages.filter(p => p.params.key === page.params.key) : [] as v}}<xhtml:link rel="alternate" hreflang="{{ v.params.lang || $site.lang }}" href="{{ v.url }}"/>{{/each}}</url>
{{/each}}
</urlset>
```

This writes one `<url>` for each page:

```xml [/sitemap.xml]
<url><loc>https://example.com/about/</loc><xhtml:link rel="alternate" hreflang="en" href="https://example.com/about/"/><xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/a-propos/"/></url>
```
