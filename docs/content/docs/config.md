---
title: Config
summary: The fields of bongo.config.ts, how plugins merge into the config, and how publicPath comes from $site.url.
group: Reference
order: 1
---

The config file, `bongo.config.ts`, sets the site metadata, the loaders, the helpers, the partials, the image defaults, the hooks, and the plugins.

## Example

```ts [bongo.config.ts]
import { markdown } from '@bongo/markdown';
import { shiki } from '@bongo/markdown/highlight';

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
	},

	$utils: {
		excerpt(text: string, len: number) {
			return text.slice(0, len);
		},
	},

	plugins: [
		markdown({
			highlighter: shiki({
				theme: 'github-dark',
				langs: ['js', 'ts', 'css', 'bash'],
			}),
		}),
	],
};
```

## The config file

bongo looks for the config in the project folder: `bongo.config.ts`, `bongo.config.mjs`, `bongo.config.cjs`, or `bongo.config.js`, in that order. Rolldown bundles it with its local imports, so it can be TypeScript and import local files. See [How a build works](/docs/project-layout/#how-a-build-works).

Export the config as the default export. Named exports for each field, such as `export const $loaders = {…}`, also work.

To type-check the config, use the `Config` type:

```ts [bongo.config.ts]
import type { Config } from 'bongo';

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
	},
} satisfies Config;
```

In a JavaScript config, use `define()` from `bongo`. It returns the config as it is, typed as `Config`:

```js [bongo.config.js]
import { define } from 'bongo';

export default define({
	$site: { title: 'My Site', url: 'https://example.com/', lang: 'en' },
});
```

## Fields

| Field | Description |
| --- | --- |
| `$site` | Site metadata. Templates read it as `{{ $site.title }}`. The `url` field also drives [publicPath](#publicpath). |
| `$loaders` | A loader map, keyed by file extension. See [Loaders](/docs/loaders/). |
| `$utils` | Helper functions that templates can call. See [`$utils`](#utils). |
| `$partials` | Programmatic partial functions. See [Config partials](/docs/partials/#config-partials). |
| `$images` | Image defaults. See [Image config](/docs/images/#image-config). |
| `$build` | Build options. See [Build targets](#build-targets). |
| `$hooks` | Functions that change the build output. See [Hooks](/docs/hooks/). |
| `plugins` | An array of partial config objects, merged in order. See [Plugins](#plugins). |

### `$site`

`$site` holds the metadata of the site. It is available in every template as `$site`:

- `title` — the site title.
- `url` — the absolute URL of the site. It sets `$page.url` and publicPath.
- `lang` — the site language.
- `description` — optional. The site description.
- `menu` — optional. Named links, as `{ name, href }` objects.

bongo itself reads only `url`. Templates get every field as it is. [@bongo/feed](/docs/feed/) also reads `title` and `lang`.

### `$utils`

`$utils` holds helper functions. Templates call them as `{{ $utils.excerpt($page.summary, 80) }}`. Layouts, partials, `.hbs` content, and [data modules](/docs/data-modules/) all get `$utils`.

bongo gives `$utils` these helpers:

| Helper | Returns |
| --- | --- |
| `truncate(text, length)` | The first `length` characters of `text`, with no ellipsis. An empty `text` gives `''`. |
| `countwords(text)` | The number of words in `text`, split on whitespace. An empty `text` gives `0`. |
| `slug(text)` | A URL or anchor slug: `text` in lower case, with punctuation, symbols, and emoji removed, and each space as `-`. Letters and digits of every language stay. It is the id that `@bongo/markdown` gives a heading with `headingIds: true`, so `slug(heading.text)` equals `heading.id`, except that `slug` does not add `-1` to a repeated slug. `slug('Hello, world!')` is `hello-world`. |
| `url.abs(to, from?)` | The full URL of `to`, resolved against `from`, or against `$site.url` when there is no `from`. For `https://example.com/blog/`, `url.abs('post/')` is `https://example.com/blog/post/`, and `url.abs('/about/')` is `https://example.com/about/`. |
| `url.path(to, from?)` | The URL path of `to`, with its query and hash, resolved as `url.abs` resolves it. For `https://example.com/blog/`, `url.path('docs/')` is `/blog/docs/`, and `url.path('/about/')` is `/about/`. A path that already starts with `/`, such as `$page.path`, stays as it is, so links work on a site under a subpath. |
| `date.format(value, options?)` | `value` as an ISO 8601 string, such as `2024-05-01T00:00:00.000Z`. With [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options) options, the date in the language of `$site.lang`, in UTC unless you set `timeZone`: `date.format('2024-05-01', { dateStyle: 'long' })` is `May 1, 2024`. An invalid date fails the build. |

A function in your `$utils` replaces the built-in one with the same name. The `url` and `date` groups merge with yours, so `$utils: { date: { year } }` keeps `date.format`. You can add your own groups too, such as `$utils: { str: { up } }`:

```ts [bongo.config.ts]
export default {
	$utils: {
		truncate(text: string, length: number) {
			return text.length > length ? text.slice(0, length) + '…' : text;
		},
		date: {
			year: (value: string) => new Date(value).getUTCFullYear(),
		},
	},
};
```

Helpers do not get `$data` automatically. Give them the value that they need. See [Data](/docs/data/#where-data-is-available).

## Build targets

`$build.target` is a [browserslist](https://browsersl.ist) query, such as `'defaults'` or `['chrome >= 110', 'safari >= 16']`. There is no default target.

```ts [bongo.config.ts]
export default {
	$build: { target: 'defaults' },
};
```

- LightningCSS uses it for each `<bongo:style>` and the CSS that it imports. It adds vendor prefixes and lowers newer syntax, such as nesting and `inset`, for the target browsers. Without a target, CSS keeps its syntax and gets no prefixes.
- Rolldown uses it for each `<bongo:script>` and for `<bongo:client>`. It lowers newer JavaScript syntax, such as `?.` and `??`. Rolldown targets Chrome, Edge, Firefox, Internet Explorer, Opera, Safari, and iOS Safari, so bongo drops the Android and Samsung entries of the query.
- `<bongo:script target="...">` replaces the target for that one script. See [Scripts](/docs/templates/#bongoscript).

## Plugins

A plugin is a partial config object. Plugins usually come from a function, such as `markdown()` from [@bongo/markdown](/docs/markdown/) or `feed()` from [@bongo/feed](/docs/feed/):

```ts [bongo.config.ts]
import { feed } from '@bongo/feed';
import { markdown } from '@bongo/markdown';

export default {
	$site: { url: 'https://example.com/', title: 'My Site', lang: 'en' },
	plugins: [markdown(), feed()],
};
```

bongo merges the plugins in order, and then the config's own fields. When plugins and the config each set `$hooks.transform`, all of them run. See [Hooks](/docs/hooks/#order).

## publicPath

bongo derives the publicPath prefix of external asset URLs from `$site.url`:

- A root-served site (`https://example.com`) gets `publicPath = /`.
- A subpath-served site (`https://example.com/blog/`) gets `publicPath = /blog/`.

You do not need to configure it. The absolute `url` of each page, in `$page.url` and `$pages`, includes the subpath too: `content/post.md` is `https://example.com/blog/post/`. `$page.path`, the paths in `$pages`, and the paths of output files, data modules, and `$hooks.transform` include it too: on `https://example.com/blog/`, `content/post.md` has the path `/blog/post/`. A root-relative path is always a URL path, as a browser requests it, so `href="{{ page.path }}"` works on any site.
