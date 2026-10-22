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

bongo looks for the config in the project folder: `bongo.config.ts`, `bongo.config.mjs`, `bongo.config.cjs`, or `bongo.config.js`, in that order. Rolldown bundles it with its local imports, so it can be TypeScript and import local files. See [How a build works](/project/#how-a-build-works).

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
| `$loaders` | A loader map, keyed by file extension. See [Loaders](/loaders/). |
| `$utils` | Helper functions that templates can call. See [`$utils`](#utils). |
| `$partials` | Programmatic partial functions. See [Config partials](/partials/#config-partials). |
| `$images` | Image defaults. See [Image config](/images/#image-config). |
| `$build` | Build options. See [Build targets](#build-targets). |
| `$hooks` | Functions that change the build output. See [Hooks](/hooks/). |
| `plugins` | An array of partial config objects, merged in order. See [Plugins](#plugins). |

### `$site`

`$site` holds the metadata of the site. It is available in every template as `$site`:

- `title` — the site title.
- `url` — the absolute URL of the site. It sets `$page.url` and publicPath.
- `lang` — the site language.
- `description` — optional. The site description.
- `menu` — optional. Named links, as `{ name, href }` objects.

bongo itself reads only `url`. Templates get every field as it is. [@bongo/feed](/feed/) also reads `title` and `lang`.

### Your own `$site` fields

Templates also get each field that you add, such as `{{ $site.icon }}`. To type-check your fields, add them to the `Site` type of `bongo`:

```ts [bongo.config.ts]
import type { Config } from 'bongo';

declare module 'bongo' {
	namespace Template {
		interface Site {
			icon: string;
		}
	}
}

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
		icon: '/icon.svg',
	},
} satisfies Config;
```

Without this, `satisfies Config` reports each new field as an error. The type change applies to all of the project, so data modules and hooks also see `$site.icon`.

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

See [Utilities](/utilities/) for every built-in helper, with examples, and for how your helpers merge with them.

## Build targets

`$build.target` names the browsers that your site supports. It is a [browserslist](https://browsersl.ist) query, or a list of queries. The default is `'defaults'`, which browserslist defines as `> 0.5%, last 2 versions, Firefox ESR, not dead`.

bongo uses the target in two places:

- **CSS**: LightningCSS adds vendor prefixes, and lowers newer syntax, such as nesting and `inset`, in each `<bongo:style>` and the CSS that it imports.
- **JavaScript**: Rolldown lowers newer syntax, such as `?.` and `??`, in each `<bongo:script>` and in `<bongo:client>`. It does not add polyfills. Rolldown knows Chrome, Edge, Firefox, Internet Explorer, Opera, Safari, and iOS Safari, so bongo drops the other browsers of the query, such as Android and Samsung.

### Set the target

Set `$build.target` in your config:

```ts [bongo.config.ts]
export default {
	$site: { url: 'https://example.com/', title: 'My site', lang: 'en' },
	$build: {
		target: ['chrome >= 120', 'safari >= 17', 'firefox >= 121'],
	},
};
```

A list means the browsers of all its queries. Some common queries:

| Query | Browsers |
| --- | --- |
| `'defaults'` | The default. Browsers with more than 0.5% of global use, the last 2 versions of each browser, and Firefox ESR, but no browser that has stopped getting updates. |
| `'baseline widely available'` | Browsers that support each [Baseline](https://web.dev/baseline) feature that is widely available. |
| `['chrome >= 120', 'safari >= 17']` | A minimum version of each browser. |
| `'last 1 chrome version, last 1 safari version, last 1 firefox version'` | Only the newest browsers. This gives the least CSS and JavaScript. |
| `'> 1% in US'` | Browsers with more than 1% of use in one country. |

To see the browsers of a query, run browserslist:

```sh
bunx browserslist 'baseline widely available'
```

bongo does not read a `.browserslistrc` file or the `browserslist` field of `package.json`. Set `$build.target` instead.

### One script

`<bongo:script target="...">` replaces the target for one script, such as a script that only newer browsers load:

```hbs
<bongo:script src="editor.ts" target="chrome >= 124, safari >= 17.4" />
```

The value is one query. Join more queries with commas. See [`<bongo:script>`](/special-elements/#bongoscript).

## Plugins

A plugin is a partial config object. Plugins usually come from a function, such as `markdown()` from [@bongo/markdown](/markdown/) or `feed()` from [@bongo/feed](/feed/):

```ts [bongo.config.ts]
import { feed } from '@bongo/feed';
import { markdown } from '@bongo/markdown';

export default {
	$site: { url: 'https://example.com/', title: 'My Site', lang: 'en' },
	plugins: [markdown(), feed()],
};
```

bongo merges the plugins in order, and then the config's own fields. When plugins and the config each set `$hooks.transform`, all of them run. See [Hooks](/hooks/#order).

## publicPath

bongo derives the publicPath prefix of external asset URLs from `$site.url`:

- A root-served site (`https://example.com`) gets `publicPath = /`.
- A subpath-served site (`https://example.com/blog/`) gets `publicPath = /blog/`.

You do not need to configure it. The absolute `url` of each page, in `$page.url` and `$pages`, includes the subpath too: `content/post.md` is `https://example.com/blog/post/`. `$page.path`, the paths in `$pages`, and the paths of output files, data modules, and `$hooks.transform` include it too: on `https://example.com/blog/`, `content/post.md` has the path `/blog/post/`. A root-relative path is always a URL path, as a browser requests it, so `href="{{ page.path }}"` works on any site.
