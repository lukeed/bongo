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

Export the config as the default export. Named exports for each field, such as `export const $assets = {…}`, also work.

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

## Fields

| Field | Description |
| --- | --- |
| `$site` | Site metadata. Templates read it as `{{ $site.title }}`. The `url` field also drives [publicPath](#publicpath). |
| `$assets` | A loader map, keyed by file extension. See [Loaders](/docs/loaders/). |
| `$utils` | Helper functions that templates can call. |
| `$partials` | Programmatic partial functions. See [Config partials](/docs/partials/#config-partials). |
| `$images` | Image defaults. See [Image config](/docs/images/#image-config). |
| `$hooks` | Functions that change the build output. See [Hooks](/docs/hooks/). |
| `plugins` | An array of partial config objects, merged in order. See [Plugins](#plugins). |

### `$site`

`$site` holds the metadata of the site. It is available in every template as `$site`:

- `title` — the site title.
- `url` — the absolute URL of the site. It sets `$page.url` and publicPath.
- `lang` — the site language.

The starter site also sets `description`.

### `$utils`

`$utils` holds helper functions. Templates call them as `{{ $utils.excerpt($page.summary, 80) }}`. Data modules also get `$utils`.

Helpers do not get `$data` automatically. Give them the value that they need. See [Data](/docs/data/#where-data-is-available).

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

You do not need to configure it. The absolute `url` of each page, in `$page.url` and `$pages`, includes the subpath too: `content/post.md` is `https://example.com/blog/post/`.
