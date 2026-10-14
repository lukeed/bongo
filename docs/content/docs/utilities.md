---
title: Utilities
summary: The helper functions that bongo gives every template as $utils, with example values, and how to add your own.
group: Reference
order: 2
---

`$utils` holds helper functions. Layouts, partials, `.hbs` content, output files, and [data modules](/docs/data-modules/) all get it. bongo gives you the helpers on this page, and you can add your own or replace these in [`bongo.config.ts`](/docs/config/#utils).

```hbs
<p>{{ $utils.excerpt($page.content, 140) }}</p>
<p>
	{{ $utils.minutes($page.content) }} min read ·
	{{ $utils.date.format($page.params.date, { dateStyle: 'long' }) }}
</p>
```

The examples on this page use a site whose `$site.url` is `https://example.com/blog/` and whose `$site.lang` is `en`.

## Text

### `excerpt(html, length)`

The plain text of `html`, cut to at most `length` characters at the end of a word, with `…` when it cuts. It removes tags, comments, scripts, and styles, decodes entities such as `&amp;`, and collapses whitespace. A block tag, such as `<p>` or `<br>`, counts as a space. A first word longer than `length` is cut. Use it for summaries in lists and for meta descriptions.

```ts
$utils.excerpt('<p>Static sites with a <b>good</b> beat.</p>', 22)
//=> 'Static sites with a…'

$utils.excerpt('<p>Tom &amp; Jerry</p>', 40)
//=> 'Tom & Jerry'
```

### `truncate(text, length)`

The first `length` characters of `text`, with no ellipsis. It does not look at words or tags. An empty `text` gives `''`.

```ts
$utils.truncate('Static sites with a good beat.', 12)
//=> 'Static sites'
```

### `countwords(text)`

The number of words in `text`, split on whitespace. An empty `text` gives `0`.

```ts
$utils.countwords('  Static sites, good beat. ')
//=> 4
```

### `minutes(text, wpm?)`

The reading time of `text` in whole minutes, rounded up, at `wpm` words a minute. `wpm` is `200` by default. It counts the words of the plain text, as `excerpt` makes it, so you can give it `$page.content`. Text with no words gives `0`.

```ts
$utils.minutes(text) // text holds 450 words
//=> 3

$utils.minutes(text, 300)
//=> 2

$utils.minutes('')
//=> 0
```

### `slug(text)`

A slug for a URL or an anchor: `text` in lower case, with punctuation, symbols, and emoji removed, and each space as `-`. Letters and digits of every language stay. It is the same id that [@bongo/markdown](/docs/markdown/#headings) gives a heading when `headingIds` is on, so `slug(heading.text)` equals `heading.id`. Unlike the heading ids, `slug` does not add `-1` to a slug that repeats.

```ts
$utils.slug('Hello, world!')
//=> 'hello-world'

$utils.slug('`<bongo:style>` attributes')
//=> 'bongostyle-attributes'
```

A list of tag pages:

```hbs
{{#each $tags as entry}}
	{{#var href = $utils.url.path('tags/' + $utils.slug(entry.tag) + '/')}}
	<a href="{{ href }}">{{ entry.tag }}</a>
{{/each}}
```

## URLs

### `url.abs(to, from?)`

The full URL of `to`. A relative `to` resolves against `from`, or against `$site.url` when there is no `from`. A `to` that starts with `/` is a path from the root of the host, as in a browser. Use it for canonical links, Open Graph tags, and feeds.

```ts
$utils.url.abs('post/')
//=> 'https://example.com/blog/post/'

$utils.url.abs('/about/')
//=> 'https://example.com/about/'

$utils.url.abs('a.png', 'https://cdn.example.com/img/')
//=> 'https://cdn.example.com/img/a.png'
```

### `url.path(to, from?)`

The URL path of `to`, with its query and hash, resolved as `url.abs` resolves it. Use it for links that you write by hand, so that they work on a site under a subpath. A path that already starts with `/`, such as `$page.path`, stays as it is.

```ts
$utils.url.path('docs/')
//=> '/blog/docs/'

$utils.url.path('search/?q=css#top')
//=> '/blog/search/?q=css#top'

$utils.url.path('/blog/post/')
//=> '/blog/post/'

$utils.url.path('/about/')
//=> '/about/'
```

## Dates

### `date.format(value, options?)`

With no `options`, `value` as an ISO 8601 string. With [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options) options, the date in the language of `$site.lang`. The time zone is UTC unless you set `timeZone`, so a build gives the same dates on every machine. `value` is a date string, a timestamp, or a `Date`. An invalid date fails the build.

```ts
$utils.date.format('2024-05-01')
//=> '2024-05-01T00:00:00.000Z'

$utils.date.format('2024-05-01', { dateStyle: 'long' })
//=> 'May 1, 2024'

$utils.date.format('2024-05-01', { month: 'short', day: 'numeric' })
//=> 'May 1'

$utils.date.format('2024-05-01', { year: 'numeric' })
//=> '2024'
```

A post date with a machine-readable value:

```hbs
<time datetime="{{ $utils.date.format(post.params.date) }}">
	{{ $utils.date.format(post.params.date, { dateStyle: 'long' }) }}
</time>
```

## JSON

### `json(value)`

`value` as JSON that is safe inside a `<script>` element. It escapes `<`, `>`, `&`, U+2028, and U+2029 as `<` and so on, so text such as `</script>` cannot end the element. `undefined` gives `null`. Print it raw, with `{{{ }}}`, because `{{ }}` would escape it as HTML.

```ts
$utils.json({ name: 'bongo', note: '</script>' })
//=> {"name":"bongo","note":"\u003c/script\u003e"}
```

Structured data for a post:

```hbs
<script type="application/ld+json">
{{{ $utils.json({
	'@context': 'https://schema.org',
	'@type': 'BlogPosting',
	headline: $page.title,
	url: $page.url,
}) }}}
</script>
```

## Your own helpers

Add helpers in the `$utils` field of the config. A function with the same name as a built-in one replaces it. The `url` and `date` groups merge with yours, so `$utils: { date: { year } }` keeps `date.format`. You can add your own groups too:

```ts [bongo.config.ts]
export default {
	$utils: {
		truncate(text: string, length: number) {
			return text.length > length ? text.slice(0, length) + '…' : text;
		},
		date: {
			year: (value: string) => new Date(value).getUTCFullYear(),
		},
		str: {
			up: (text: string) => text.toUpperCase(),
		},
	},
};
```

Templates then call `{{ $utils.date.year(post.params.date) }}` and `{{ $utils.str.up($page.title) }}`.

A helper gets only the values that you give it. It does not get `$data` or `$page` by itself, so pass them in: `{{ $utils.total($data.stats) }}`. See [Data](/docs/data/#where-data-is-available).
