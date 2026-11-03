---
title: "@bongo/tailwind"
summary: The Tailwind CSS plugin for bongo, which builds each stylesheet from the classes that your pages render.
group: Plugins
order: 3
---

`@bongo/tailwind` builds [Tailwind CSS](https://tailwindcss.com) v4 stylesheets for bongo. It reads the class names of each page as bongo renders it, so the stylesheet holds the utilities that your pages use, and no others.

## Install

```sh
bun add -d @bongo/tailwind tailwindcss
```

## Usage

Add the plugin to `bongo.config.ts`:

```ts [bongo.config.ts]
import { tailwind } from '@bongo/tailwind';

export default {
	$site: { url: 'https://example.com/', title: 'My Site', lang: 'en' },
	plugins: [tailwind()],
};
```

Import Tailwind in a stylesheet, and link it as any other:

```css [assets/app.css]
@import "tailwindcss";
```

```hbs [layouts/html.hbs]
<bongo:style src="app.css" />
```

## Where the classes come from

Tailwind usually scans your source files for class names. bongo has the HTML of each page, so the plugin uses that instead:

- **Pages.** Each class name in a `class` attribute of a rendered page. A class that a template prints in one branch only, such as `{{ on ? 'text-red-500' : 'text-blue-500' }}`, is in the stylesheet only when a page renders that branch. The words of your text never become utilities.
- **Scripts.** Each class name in the scripts of the folder of the stylesheet, such as `assets/`. A script can add a class that no page has yet, such as a class that opens a menu.
- **`@source`.** Each file that an `@source` of the stylesheet names, as in Tailwind.

`@import "tailwindcss" source("../src")` scans that folder, with all of its files, in place of the scripts of the stylesheet's folder. `source(none)` scans no folder.

The plugin builds a stylesheet that imports `tailwindcss` or uses a Tailwind at-rule, such as `@theme`, `@utility`, or `@apply`. It leaves other stylesheets as they are.

A stylesheet that only applies or references utilities, such as a [CSS module](/css/#css-modules) with `@reference "tailwindcss"` and `@apply`, writes no utilities of its own, so it needs no classes of the pages. Thus `$assets.classes()` can read its class names while a page renders.

## Builds and dev

A page that renders a new class name changes the stylesheet in the same build. In `bongo build`, the stylesheet then gets a new name, so every page that links it renders again, as after a stylesheet edit. `bongo dev` names a stylesheet by its entry, so no other page renders again.

The pages that a build keeps from the last build keep their class names in the [record of the last build](/cli/#incremental-builds), so an incremental build makes the same stylesheet as a fresh build.

`bongo dev` watches `assets/`, `content/`, `layouts/`, and `partials/`. A change to a file that only an `@source` names outside of them shows after the next change that bongo sees.

## Files in `url()`

Tailwind puts each stylesheet that you `@import` into one file. The plugin keeps the path of each `url()` relative to the stylesheet that bongo builds, so fonts and images in packages, such as `@fontsource`, work. See [Files in url()](/css/#files-in-url).
