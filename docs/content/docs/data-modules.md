---
title: Data modules
summary: How a .json.ts or .json.js file in content/ runs at build time and writes its default export as a JSON file.
group: Guides
order: 10
---

A `.json.ts` or `.json.js` file in `content/` is a data module. bongo runs it and writes its default export as JSON, without the script extension. Use data modules for search indexes and other JSON files.

## Paths

| File | Output |
| --- | --- |
| `content/search.json.ts` | `/search.json` |
| `content/blog/posts.json.js` | `/blog/posts.json` |

## The default export

The default export is a value, or a function that returns one. The function receives `$site`, `$pages`, `$section`, `$tags`, `$data`, and `$utils`, as [`.hbs` content](/docs/content/#hbs-content) does, and it may be async. `$section` holds the pages in the module's own folder. Type the function with `Build.Data`:

```ts [content/search.json.ts]
import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages
	.filter(page => page.section === 'blog')
	.map(page => ({ title: page.title, path: page.path }));
```

Each page in `$pages` has its [`headings`](/docs/variables/#page). A search index can list the sections of each page without a second read of the sources:

```ts [content/search.json.ts]
import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages.map(page => ({
	title: page.title,
	path: page.path,
	sections: page.headings.filter(h => h.level === 2).map(h => ({ id: h.id, text: h.text })),
}));
```

bongo runs data modules once every page is known. See [How a build works](/docs/project-layout/#how-a-build-works).

## How it differs from a page

A data module is like an [output file](/docs/output-files/):

- It is not a page. It gets no layout, and it is not in `$pages`, `$section`, or `$tags`. bongo never minifies it or passes it to [`$hooks.transform`](/docs/hooks/). The JSON is always compact.
- It may import local files and packages, as the config does. It runs on every build, so it always reads the current pages.
- `bongo dev` serves it as `application/json`. It runs again after every change to a page, to the module, or to a local file that it imports.

## Errors

The build fails, and the error names the file, when the module:

- has no default export,
- throws,
- returns something that JSON cannot hold, such as `undefined`.
