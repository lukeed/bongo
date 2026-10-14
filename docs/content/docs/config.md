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

`$utils` holds helper functions for templates, such as `{{ $utils.excerpt($page.content, 140) }}`. bongo gives you built-in helpers for text, URLs, dates, and JSON. Add your own here, or replace a built-in one:

```ts [bongo.config.ts]
export default {
	$utils: {
		date: {
			year: (value: string) => new Date(value).getUTCFullYear(),
		},
	},
};
```

See [Utilities](/docs/utilities/) for every built-in helper, with examples, and for how your helpers merge with them.

## Build targets

`$build.target` is a [browserslist](https://browsersl.ist) query, such as `'defaults'` or `['chrome >= 110', 'safari >= 16']`. There is no default target.

```ts [bongo.config.ts]
export default {
	$build: { target: 'defaults' },
};
```

- LightningCSS uses it for each `<bongo:style>` and the CSS that it imports. It adds vendor prefixes and lowers newer syntax, such as nesting and `inset`, for the target browsers. Without a target, CSS keeps its syntax and gets no prefixes.
- Rolldown uses it for each `<bongo:script>` and for `<bongo:client>`. It lowers newer JavaScript syntax, such as `?.` and `??`. Rolldown targets Chrome, Edge, Firefox, Internet Explorer, Opera, Safari, and iOS Safari, so bongo drops the Android and Samsung entries of the query.
- `<bongo:script target="...">` replaces the target for that one script. See [`<bongo:script>`](/docs/special-elements/#bongoscript).

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
