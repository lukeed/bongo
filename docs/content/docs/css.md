---
title: CSS
summary: How bongo builds CSS with LightningCSS, including CSS modules, packages in @import, and files in url().
group: Guides
order: 7
---

All CSS is handled by [LightningCSS](https://lightningcss.dev): `@import` bundling, autoprefixing, nesting, and optional minification. Add a stylesheet to a layout with `<bongo:style>`.

Prefixes and lowered syntax need a [build target](/docs/config/#build-targets). Without one, LightningCSS keeps your syntax, nesting included, and adds no prefixes.

## Add a stylesheet

```hbs
<bongo:style src="app.css"></bongo:style>
```

The `src` is relative to `assets/`. bongo emits a `<link rel="stylesheet">` to the built file. With `inline`, it splices the built CSS into a `<style>` block. See [`<bongo:style>`](/docs/templates/#bongostyle) for all attributes.

With `--minify`, LightningCSS minifies every stylesheet, inline ones included. See [Minify](/docs/cli/#minify).

## CSS modules

`.module.css` files automatically enable CSS modules.

To turn off the auto-detection for a `.module.css` file, add `global` to its element:

```hbs
<bongo:style src="theme.module.css" global></bongo:style>
```

## Packages in `@import`

An `@import` can name a package in `node_modules`:

```css
@import "@twinkleplop/theme-github";
@import "@twinkleplop/theme-github/dark";
@import "some-pkg/dist/theme.css";
```

bongo first looks for the path next to the CSS file, so `@import "theme.css"` still loads the `theme.css` beside it. If that file does not exist, bongo looks for the package in the `node_modules` folder next to the CSS file, then in the `node_modules` folder of each parent folder. Thus workspaces and hoisted packages work. bongo follows symlinks.

In the package, bongo uses the first of these that is a file:

1. A `.css` target in the `exports` of its `package.json`, with the `style`, `import`, or `require` condition, in that order. The `default` condition applies with each one.
2. The `style` field, when you import the package itself.
3. The path after the package name, as a file in the package. For `some-pkg/dist/theme.css`, this is `dist/theme.css`.

Relative (`./`, `../`), absolute (`/`), and URL imports do not change. A `url()` in a package stylesheet resolves against that stylesheet, as [Files in url()](#files-in-url) describes. Thus the fonts and images that a theme package ships work.

If nothing resolves, the build fails with an error that names the `@import` and the CSS file that contains it.

`bongo dev` does not watch these packages. After you update one, save the CSS file that imports it, or restart `bongo dev`.

## Files in `url()`

Fonts, images, and other files that CSS references with a relative `url()` can live next to the CSS under `assets/`. Each `url()` resolves against the CSS file that contains it, including files pulled in with `@import`.

```css [assets/theme/fonts.css]
@font-face {
	font-family: Inter;
	src: url("../fonts/inter.woff2") format("woff2");
}
```

bongo copies each referenced file to the output once, with a content hash in its name. It rewrites the `url()` to the file's public path under [publicPath](/docs/config/#publicpath), for example `url("/inter.3f9a1c2e.woff2")`. A `?query` or `#fragment` on the URL stays. Linked and inline styles behave the same, and `bongo dev` rebuilds when a referenced file changes.

A file that both CSS and a `<bongo:asset>` use gets one copy and one URL. Use `<bongo:asset preload>` to preload a font that your CSS loads. See [`<bongo:asset>`](/docs/templates/#bongoasset).

These URLs stay as written:

- external URLs, such as `https:`, `//cdn.example.com/…`, and `data:`
- root-relative URLs, such as `/img/logo.png`, which point at files from `content/`. The browser requests them as written, so on a site under a subpath they must start with it.
- fragment-only URLs, such as `url(#gradient)`

If a relative `url()` points at a file that does not exist, the build fails with an error that names the URL and the CSS file that contains it.
