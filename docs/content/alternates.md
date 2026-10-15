---
title: Alternates
summary: How <bongo:alternate> links other versions of a page, such as a Markdown copy, a feed, or a translation, and how output files and data modules list them.
group: Guides
order: 13
---

An alternate is another version of the same page, such as the page in another format, or a feed of its section. HTML names one with `<link rel="alternate">`, and tools follow it, such as feed readers and AI tools. In bongo, you write `<bongo:alternate>` in a layout.

## Link an alternate

```hbs [layouts/html.hbs]
<head>
	<bongo:alternate type="application/rss+xml" href="/feed.xml" title="Blog" />
	<bongo:alternate type="text/markdown" />
</head>
```

On the page `/about/`, this becomes:

```html
<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Blog"/>
<link rel="alternate" type="text/markdown" href="/about.md"/>
```

- `type` — the media type of the other version. Required.
- `href` — its URL. A relative `href` resolves against the URL of the page, as a browser resolves it.
- All other attributes, such as `title`, go on the `<link>`.

For the other languages of a page, write plain `<link hreflang>` elements. See [Translations](/translations/).

## Markdown copies

For `type="text/markdown"`, bongo also writes the file: a Markdown copy of the page. The `href` is then optional, and defaults to the route of the page plus `.md`. See [Markdown copies](/markdown-copies/).

## List the alternates of each page

Output files and data modules render after every page, so each entry of `$pages` has `alternates`: the alternates of the page, by type. A link to a file of the site is a URL path; a link to another site is a full URL. It holds one link for each type: when a page links two alternates of one type, such as two feeds, it holds the last.

```ts
{
	path: '/about/',
	title: 'About',
	alternates: {
		'text/markdown': '/about.md',
		'application/rss+xml': '/feed.xml',
	},
	…
}
```

Thus a data module can list them:

```ts [content/alternates.json.ts]
import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages.map(page => ({
	path: page.path,
	alternates: page.alternates,
}));
```

To list every Markdown copy for AI tools, see [Create an llms.txt](/llms-txt/).

## In the page itself

A page's own templates cannot read its alternates, because bongo finds the elements after the layouts render. To link an alternate in the page, give it the same URL. For a Markdown copy, [`$utils.url.ext()`](/utilities/#urlextpath-ext) gives the default:

```hbs
<a href="{{ $utils.url.ext($page.path, 'md') }}">View as Markdown</a>
```

See [`<bongo:alternate>`](/special-elements/#bongoalternate) for each rule.
