---
title: Hooks
summary: How $hooks.transform changes each page and output file after it renders and before bongo writes it.
group: Reference
order: 4
---

`$hooks.transform(text, ctx)` changes each page and each [output file](/docs/output-files/) after it renders and before bongo writes it. Pages arrive with their final asset URLs. Return the new text, or a promise of it. [Data modules](/docs/data-modules/) do not pass through it.

## Example

```ts [bongo.config.ts]
export default {
	$hooks: {
		transform(text, ctx) {
			return ctx.kind === 'page' ? text.replace('{year}', String(new Date().getFullYear())) : text;
		},
	},
};
```

## Context

`ctx` has:

- `kind` — `'page'` or `'output'`.
- `path` — the URL path, such as `/blog/post/` or `/blog/index.xml`.
- `params` — the frontmatter.
- `outputs` — every output file of the build, as `{ path, params }`, sorted by path.
- `config` — the config, with its plugins merged.

To type a hook, use `Build.Transform` from `bongo`. See [TypeScript](/docs/typescript/).

## Order

When plugins and the config each set `transform`, all of them run: first the plugins, in order, then the config's own. Each one gets the text that the one before it returned.

[@bongo/feed](/docs/feed/) is a plugin of this kind. Its `transform` turns feed files into RSS or Atom, and turns `<feed:link>` elements in pages into links.

## Errors

If a hook throws, the build fails. The error names the content file and the layouts that rendered it.
