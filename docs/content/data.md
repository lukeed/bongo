---
title: Data
summary: How to put JSON, YAML, and module files in data/ and read them in every template as $data.
group: Guides
order: 5
---

Put JSON, YAML, or module files in `data/` to use them in every template as `$data`.

## Keys

A file's key is its path without the extension:

| File | Template value |
| --- | --- |
| `data/site.yaml` | `$data.site` |
| `data/oss/history.json` | `$data.oss.history` |
| `data/stats.ts` | `$data.stats`, the module's default export |

```hbs
<ul>
{{#each $data.oss.history as row}}
  <li>{{ row[0] }}: {{ row[1] }}</li>
{{/each}}
</ul>
```

Use brackets for a key that is not a valid name: `$data.oss['arr-filter']`.

## File types

- JSON files end in `.json`.
- YAML files end in `.yaml` or `.yml`. They use the same subset as frontmatter. See [The YAML subset](/frontmatter/#the-yaml-subset).
- A `.ts`, `.mts`, `.js`, `.mjs`, or `.cjs` file must have a default export. It can use top-level `await`, for example to fetch data at build time. bongo loads it as it loads the config. See [How a build works](/project/#how-a-build-works).

```ts [data/stats.ts]
let res = await fetch('https://example.com/stats.json');

export default await res.json();
```

## Rules

- Data from JSON and YAML files is read-only. Copy it before you sort it: `$data.posts.toSorted(...)`.
- bongo skips files and folders whose names start with `.`.
- Any other file type fails the build.
- Two files with the same key, such as `data/a.json` and `data/a.yaml`, also fail the build.

## Where `$data` is available

`$data` is available in layouts, partials, and `.hbs` content. [Output files](/output-files/) and [data modules](/data-modules/) get it too.

Helpers in `$utils` do not get `$data` automatically. Give them the value that they need:

```hbs
{{ $utils.total($data.oss.history) }}
```

## Changes in dev

In `bongo dev`, a change to a file in `data/` loads the config and the data again, then rebuilds every page. You do not need to restart. See [Dev server](/dev-server/#config-and-data-changes).
