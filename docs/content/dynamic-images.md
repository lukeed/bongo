---
title: Dynamic images
summary: How $assets.render draws a partial as an SVG, PNG, JPEG, or WebP image from your page data, and which runtimes each format needs.
group: Guides
order: 7
---

`$assets.render` draws a partial as an image, and returns the URL path of that image. Use it for any image that comes from your page data: a banner for each post, a badge for each tag, or a social card for each page.

```hbs [layouts/blog/single.hbs]
{{#var file = 'banners/' + $utils.slug($page.title) + '.png'}}
{{#var banner = await $assets.render('banner', file, { width: 1600, height: 400 })}}
<img src="{{ banner }}" width="1600" height="400" alt=""/>
```

For a social card on each page, see [Open Graph images](/open-graph-images/). It builds on this guide.

## Install

bongo draws the image with [Satori](https://github.com/vercel/satori), and converts the drawing to pixels with [resvg](https://github.com/thx/resvg-js). They are optional peer dependencies, so add them to your site:

```sh
bun add -d satori @resvg/resvg-js
```

SVG output needs only `satori`. If a package is missing, the build fails and tells you what to install.

## Arguments

```hbs
{{#var url = await $assets.render(template, output, options)}}
```

- `template` — the name of a partial, such as `og/card` for `partials/og/card.hbs`.
- `output` — optional. The path of the image in `public/`, such as `og/home.png`. The extension sets the format. Without `output`, the image is a PNG with a name from its partial and its content, such as `card.3f9a1c2e.png`.
- `options.width`, `options.height` — the size in pixels. The defaults are 1200 and 630, the size of a social card.
- `options.args` — values for the partial, as the attributes of `{{#partial}}` are.

The partial gets the `$page`, `$pages`, `$section`, and `$tags` of the page that calls `$assets.render`. This is also true when a layout or another partial calls it.

The return value is a URL path, such as `/og/home.png`. On a site under `/blog/`, it starts with `/blog/`. Use `$utils.url.abs()` to make a full URL.

Without `output`, the name changes when the image changes. Thus a host can cache these images for a long time, as it does other hashed files.

## Formats

| Extension | Made with | Runtimes |
| --- | --- | --- |
| `.svg` | Satori | Bun, Deno, and Node |
| `.png` | Satori and resvg | Bun, Deno, and Node |
| `.jpg`, `.jpeg`, `.webp` | Satori, resvg, and `Bun.Image` | Bun only |

JPEG and WebP use [`Bun.Image`](https://bun.com/docs/runtime/image), as [image processing](/images/#bun-runtime) does. Thus they need the Bun runtime. Under Deno or Node, they fail the build. Their quality comes from [`$images.quality`](/images/#image-config).

## The template

A render template is a partial with one root element. Satori draws a subset of HTML and CSS, with flexbox layout. See the [Satori documentation](https://github.com/vercel/satori#css) for the CSS that it supports.

```hbs [partials/banner.hbs]
<style>
	@font-face { font-family: Inter; src: url(fonts/inter-700.woff); font-weight: 700 }
</style>
<div style="display: flex; flex-direction: column; justify-content: flex-end; width: 100%; height: 100%; padding: 64px; box-sizing: border-box; background: #ffd23f; font-family: Inter">
	<img src="img/logo.svg" width="120" height="40">
	<div style="margin-top: 16px; font-size: 80px">{{ $page.title }}</div>
	<div style="margin-top: 12px; font-size: 28px">{{ $utils.excerpt($page.summary, 100) }}</div>
</div>
```

- Set styles with the `style` attribute. Classes and stylesheets have no effect.
- Give a box with padding `box-sizing: border-box`, or Satori adds the padding to its width.
- Put an element in place with `left` and `top`. Satori does not always obey `right` and `bottom`.
- An inline `<svg>` needs a `width` and a `height`.

### Fonts

Declare each font with an `@font-face` rule, in a `<style>` element of the template. The `src` is a path in `assets/`. bongo reads the rules, then removes the `<style>` element. A `<style>` element may hold only `@font-face` rules.

Satori reads TTF, OTF, and WOFF files, but not WOFF2. bongo uses the first `src` that is not WOFF2. A template with text must declare one font or more. The font files are not copied to `public/`.

### Images

An `<img src>` or a CSS `url()` with a path reads that file from `assets/`. bongo puts the contents of the file into the drawing. A remote URL stays as it is: Satori gets it when it draws. The cache knows only its URL, so a changed remote image does not make a new drawing.

## Dev and cache

`bongo build` draws all the images. `bongo dev` draws an image at its first request.

bongo keeps each drawing in `node_modules/.cache/bongo/render`. The key is a hash of the drawing, the fonts, the images, the size, the format, and the versions of Satori, resvg, and Bun. A rebuild copies unchanged images from the cache. [`$images.prune`](/images/#cache) also cleans this folder. To clear the cache, delete the folder.

## Errors

The build fails with a message that names the cause when:

- two pages draw different images to the same `output`;
- `output` is a file of the site, or a path outside `public/`;
- the template has no root element, or more than one;
- the template has text, but declares no fonts;
- a font is WOFF2, or a file is not in `assets/`;
- a `<style>` element holds rules other than `@font-face`.
