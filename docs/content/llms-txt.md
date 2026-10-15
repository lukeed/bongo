---
title: llms.txt
summary: How to give AI tools a Markdown copy of each page with <bongo:alternate>, and how to write an /llms.txt file that lists them.
group: Guides
order: 11
---

AI tools read Markdown better than HTML. [llms.txt](https://llmstxt.org) is a Markdown file at the root of a site, `/llms.txt`, that lists the pages of the site, with a link to a Markdown copy of each page. This guide makes both with bongo. This site uses the same setup: see [/llms.txt](/llms.txt), or open the **Copy page** menu at the top of this page.

## Make a Markdown copy of each page

Put a `<bongo:alternate>` element in the `<head>` of your layout:

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

The copy holds the title and the summary from the frontmatter, then the Markdown of the page as you wrote it:

```md [/config.md]
# Config

> The fields of bongo.config.ts, and how plugins merge into the config.

The config file, `bongo.config.ts`, sets the site metadata, …
```

A page from an `.html` or `.hbs` file has no Markdown to copy, so it gets no copy and no `<link>`. Thus one layout can serve every page. To make copies for some Markdown pages only, put the element in the layout of their folder, or in an `{{#if}}` block. See [`<bongo:alternate>`](/special-elements/#bongoalternate).

## Write llms.txt

`content/llms.txt.hbs` is an [output file](/output-files/): it writes `/llms.txt`. Output files render after every page, so each entry of `$pages` has `alternates`, with the URL of its Markdown copy:

```hbs [content/llms.txt.hbs]
# {{{ $site.title }}}

> {{{ $site.description }}}

## Pages
{{#each $pages.filter(page => page.alternates['text/markdown']) as page}}
- [{{{ page.title }}}]({{{ $utils.url.abs(page.alternates['text/markdown']) }}}): {{{ page.summary }}}{{/each}}
```

This writes:

```md [/llms.txt]
# My site

> Notes about "static" sites & bongo.

## Pages
- [About](https://example.com/about.md): Who we are & why.
- [Config](https://example.com/config.md): The config file.
```

Three details make the file correct:

- Use `{{{ }}}`, not `{{ }}`. `{{ }}` escapes `&`, `<`, and `"` for HTML, and a text file must keep them.
- Start each line of a loop just after a tag, as in `{{#each …}}` and then `- […`. tempura removes the line break just before each tag. See [Whitespace](/output-files/#whitespace).
- `$utils.url.abs()` makes each link a full URL, so that the file works when a tool reads it from somewhere else.

To group the list, loop over your own groups. This site groups its pages by the `group` of their frontmatter: see its [llms.txt.hbs](https://github.com/lukeed/bongo/blob/main/docs/content/llms.txt.hbs).

## Add Copy page and View as Markdown

A page cannot read its own `alternates`, because bongo finds the element only after the layouts render. `$utils.url.ext()` gives the same URL that the element uses:

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

- `bongo dev` serves each copy, and makes it the first time that you open it, such as `/config.md`.
- `bongo build` writes each copy to `public/`. Open `public/llms.txt` to see the list.
