---
title: Create an llms.txt
summary: How to write an /llms.txt file that lists the Markdown copy of each page, for AI tools.
group: Guides
order: 14
---

[llms.txt](https://llmstxt.org) is a Markdown file at the root of a site, `/llms.txt`, that lists the pages of the site, with a link to a Markdown copy of each page. AI tools read it to find your pages. This site has one: see [/llms.txt](/llms.txt).

First, make a Markdown copy of each page. See [Markdown copies](/markdown-copies/).

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

## Three details

- Use `{{{ }}}`, not `{{ }}`. `{{ }}` escapes `&`, `<`, and `"` for HTML, and a text file must keep them.
- Start each line of a loop just after a tag, as in `{{#each …}}` and then `- […`. tempura removes the line break just before each tag. See [Whitespace](/output-files/#whitespace).
- `$utils.url.abs()` makes each link a full URL, so that the file works when a tool reads it from somewhere else.

## Group the list

To group the list, loop over your own groups. This site groups its pages by the `group` of their frontmatter, as its sidebar does: see its [llms.txt.hbs](https://github.com/lukeed/bongo/blob/main/docs/content/llms.txt.hbs).

## Check it

- `bongo dev` serves `/llms.txt`, and renders it again after each change to a page.
- `bongo build` writes `public/llms.txt`.
