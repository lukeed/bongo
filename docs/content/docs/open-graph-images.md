---
title: Open Graph images
summary: Give each page its own social card with $assets.render, the Open Graph and X meta tags, and a frontmatter image that replaces the card.
group: Guides
order: 8
---

When someone shares a link to your site, apps such as Slack, Discord, iMessage, and X show a preview card. The image of that card comes from the `og:image` meta tag of the page. This guide draws a card for each page with `$assets.render`, and adds the meta tags. Read [Render dynamic images](/docs/dynamic-images/) first.

## Install

```sh
bun add -d satori @resvg/resvg-js
```

## Add a font

Satori reads TTF, OTF, and WOFF files, but not WOFF2. Put the fonts of your card in `assets/`. [Fontsource](https://fontsource.org) packages have WOFF files for each weight, such as `@fontsource/inter/files/inter-latin-700-normal.woff`. Copy the file into `assets/fonts/`:

```sh
cp node_modules/@fontsource/inter/files/inter-latin-700-normal.woff assets/fonts/inter-700.woff
```

The font files are not copied to `public/`. Only the cards use them.

## Draw the card

A card is 1200 by 630 pixels, the default size of `$assets.render`. This partial prints the title and the summary of the page, and the name and the address of the site:

```hbs [partials/og/card.hbs]
<style>
	@font-face { font-family: Inter; src: url(fonts/inter-700.woff); font-weight: 700 }
</style>
<div style="display: flex; flex-direction: column; width: 100%; height: 100%; padding: 72px 80px; box-sizing: border-box; background: #141414; color: #fffdf7; font-family: Inter">
	<div style="font-size: 32px; color: #ffd23f">{{ $site.title }}</div>
	<div style="margin-top: auto; font-size: 88px; line-height: 1.05">{{ $page.title }}</div>
	<div style="margin-top: 24px; font-size: 32px; color: #fffdf7b3">{{ $utils.excerpt($page.summary, 110) }}</div>
	<div style="margin-top: 40px; font-size: 26px">{{ $page.url.replace(/^https?:\/\//, '') }}</div>
</div>
```

In dev, open the URL that `$assets.render` returns to see the card. bongo draws it again when you change the partial.

## Add the meta tags

Put the tags in the `<head>` of your layout. `og:image` must be a full URL, so give the path to `$utils.url.abs()`. It resolves against `$site.url`, so set `$site.url` to the address of the live site.

```hbs [layouts/html.hbs]
{{#var path = await $assets.render('og/card')}}
{{#var card = $utils.url.abs(path)}}
<meta property="og:type" content="website"/>
<meta property="og:title" content="{{ $page.title }}"/>
<meta property="og:description" content="{{ $page.summary }}"/>
<meta property="og:url" content="{{ $page.url }}"/>
<meta property="og:image" content="{{ card }}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="{{ $page.title }}"/>
<meta name="twitter:card" content="summary_large_image"/>
```

X reads the `og:` tags too. `twitter:card` tells it to show the large image.

## Name the cards

Do not give an `output` path. Then each card has a name from its content, such as `card.3f9a1c2e.png`, and the name changes when the card changes. Thus your host can cache cards for a long time, and an app that shares the link gets the new card.

With a fixed path, such as `og/home.png`, the URL stays the same when the card changes. Caches and apps can then show the old card.

## Change the card for some pages

Give the partial values with `args`, such as a color for each section:

```hbs [layouts/html.hbs]
{{#var tones = { blog: '#ff5a36', docs: '#7cc4ff' } }}
{{#var tone = tones[$page.section] || '#ffd23f'}}
{{#var path = await $assets.render('og/card', undefined, { args: { tone } })}}
{{#var card = $utils.url.abs(path)}}
```

The partial declares the value with `{{#expect tone}}`, and uses it in a style, such as `background: {{ tone }}`.

Draw cards for some pages only with `{{#if}}`, such as `{{#if $page.section === 'blog'}}`.

## Use your own image

A page can name its own image in its frontmatter, in place of the drawn card:

```md [content/launch.md]
---
title: Launch day
image: img/launch.jpg
---
```

`<bongo:asset>` publishes that file from `assets/`. It writes a URL path, so put the origin of the site in front of it:

```hbs [layouts/html.hbs]
{{#var image = $page.params.image}}
{{#var origin = new URL($site.url).origin}}
{{#if image}}
<meta property="og:image" content="{{ origin }}<bongo:asset src='{{ image }}' />"/>
{{#else}}
{{#var path = await $assets.render('og/card')}}
<meta property="og:image" content="{{ $utils.url.abs(path) }}"/>
{{/if}}
```

Give the width, height, and type of your own image too, or leave those tags out for it.
