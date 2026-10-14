---
title: Loaders
summary: How loaders in $loaders transform content files by extension, how bongo chains them, and the utilities that each loader gets.
group: Reference
order: 4
---

Loaders transform content files by file extension. Register them with the `$loaders` config field.

## Register a loader

A loader gets the file name, its content, and a set of [utilities](#loader-utilities). It returns the new file name, the new content, and optional metadata and headings:

```ts [bongo.config.ts]
export const $loaders = {
	md(filename, content, utils) {
		return {
			filename: filename + '.html',
			content: renderedHtml,
			metadata: { title: '...' },
			headings: [{ level: 2, id: 'install', text: 'Install' }],
		};
	},
};
```

bongo passes the content of the file as a `Uint8Array`. Use `utils.decode` to read it as text. The `metadata` becomes the frontmatter of the page, in `$page.params`.

`headings` lists the headings of the HTML, in document order, as `{ level, id, text, html }`. `html` is optional: without it, bongo uses the escaped `text`. The list becomes `$page.headings`, and the page's entry in `$pages`. When more than one loader in a [chain](#loader-chains) gives headings, the last one wins.

<bongo:note>
You can use [@bongo/markdown](/docs/markdown/) for a ready-made Markdown loader.
</bongo:note>

## Loader chains

bongo chains loaders by extension. A `.md` file produces `.md.html`. The `.html` extension stops the chain, and the file enters the template pipeline as a page.

When a loader returns a file name with a new extension that has its own loader, that loader runs next. The chain stops when the extension does not change, when no loader exists for it, or when it is `.html`, `.htm`, or `.hbs`.

## Loader utilities

- `utils.decode(uint8array)` — convert a buffer to a string.
- `utils.render(partialName, args)` — invoke a registered partial. See [Partials](/docs/partials/).
- `utils.attrs(input)` — parse element attributes, like `title="Hi" count=2 tags=[a, b] featured`, into data. Values are never evaluated. `@bongo/markdown` uses it for `<bongo:*>` partial elements. See [Elements](/docs/markdown/#elements).
- `utils.frontmatter(content)` — parse the `---` block at the top of `content`, as [Frontmatter](/docs/frontmatter/) describes. It returns `{ offset, value }`, where `offset` is where the body starts.

## Types

Type a loader with the `Loader` type from `bongo`. See [TypeScript](/docs/typescript/).
