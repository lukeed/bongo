---
title: Markdown copies
summary: How bongo writes a Markdown copy of each page for AI tools, and how to add Copy page and View as Markdown buttons.
group: Guides
order: 12
---

AI tools read Markdown better than HTML. bongo can write a Markdown copy of each page next to its HTML, such as `/config.md` for `/config/`. This site does it: open the **Copy page** menu at the top of this page.

## Make a copy of each page

Put a `<bongo:alternate>` element of type `text/markdown` in the `<head>` of your layout:

```hbs [layouts/html.hbs]
<head>
	<meta charset="utf-8"/>
	<title>{{ $page.title }}</title>
	<bongo:alternate type="text/markdown" />
</head>
```

For each page from a Markdown file, bongo:

- writes the copy at the route of the page plus `.md`: `/config/` gives `/config.md`, and `/` gives `/index.md`.
- puts `<link rel="alternate" type="text/markdown" href="/config.md"/>` in place of the element, so that tools find the copy.

The element can also link other versions of a page, such as a feed. See [Alternates](/alternates/).

## What a copy holds

A copy holds the `title` and the `summary` from the frontmatter, then the Markdown of the page as you wrote it:

```md [/config.md]
# Config

> The fields of bongo.config.ts, and how plugins merge into the config.

The config file, `bongo.config.ts`, sets the site metadata, …
```

bongo reads the source file again when it writes the copy, so a build does not keep every page's Markdown in memory. `bongo dev` makes a copy the first time that you open it.

## Choose the pages

- A page from an `.html` or `.hbs` file has no Markdown to copy. It gets no copy and no `<link>`, so one layout can serve every page.
- To make copies for some Markdown pages only, put the element in the layout of their folder, or in an `{{#if}}` block.
- Two pages that name the same copy, or a copy that lands on another file of the site, fail the build.

## Add Copy page and View as Markdown

A page cannot read its own alternates, because bongo finds the element only after the layouts render. [`$utils.url.ext()`](/utilities/#urlextpath-ext) gives the same URL that the element uses:

```hbs [layouts/html.hbs]
{{#var md = $utils.url.ext($page.path, 'md')}}
<a href="{{ md }}" target="_blank">View as Markdown</a>
<button type="button" data-copy-page="{{ md }}">Copy page</button>
```

```ts [assets/main.ts]
document.addEventListener('click', event => {
	let button = event.target instanceof Element && event.target.closest<HTMLElement>('[data-copy-page]');
	if (!button) return;
	let text = fetch(button.dataset.copyPage ?? '')
		.then(res => res.text())
		.then(text => new Blob([text], { type: 'text/plain' }));
	navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
});
```

Safari allows a write to the clipboard only while the click is current. Thus the script gives `ClipboardItem` the fetch as a promise, and does not wait for the fetch first.

## Check it

- `bongo dev` serves each copy. Open one, such as `/config.md`.
- `bongo build` writes each copy to `public/`, next to the HTML of its page.

To list every copy in one file for AI tools, see [Create an llms.txt](/llms-txt/).
