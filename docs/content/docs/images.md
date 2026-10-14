---
title: Images
summary: How bongo resizes and converts images with Bun.Image, the bongo:image element, content images, the image cache, and the $images config.
group: Guides
order: 6
---

bongo resizes and converts images. It gives each image a `srcset`, a `width`, and a `height`. Use the `<bongo:image>` element for a `<picture>` with more than one format, or write a plain `<img>` in your content.

## Bun runtime

bongo resizes and converts images with [`Bun.Image`](https://bun.com/docs/runtime/image), so image processing needs the Bun runtime. The `bongo` command starts with Node, so run it through Bun:

```sh
bunx --bun bongo build
bun --bun run build   # for a "build": "bongo build" script
```

Under Node, bongo copies each image as it is, under a hashed name, and prints one notice for each build. The build does not fail. bongo adds `width` and `height` only to SVG and GIF images.

JPEG, PNG, and WebP files are encoded with the same codecs on every platform. Thus a build makes the same bytes on macOS, Linux, and Windows.

[`$assets.render`](/docs/rendered-images/) also uses `Bun.Image`, to write JPEG and WebP images. Its SVG and PNG images work in every runtime.

## Width and height

bongo adds `width` and `height` to images. If your CSS limits the width of images, also give them `height: auto`, so that they keep their aspect ratio:

```css
img { max-width: 100%; height: auto; }
```

## The image element

```hbs
<bongo:image src="img/hero.jpg" alt="A hero" sizes="(min-width: 800px) 720px, 100vw" />
```

With the default settings and a 2400×1600 JPEG, this becomes the following HTML, on one line:

```html
<picture>
  <source type="image/webp" srcset="/hero-640.1a2b3c4d.webp 640w, /hero-960.2b3c4d5e.webp 960w, /hero-1280.3c4d5e6f.webp 1280w, /hero-1920.4d5e6f7a.webp 1920w, /hero-2400.5e6f7a8b.webp 2400w" sizes="(min-width: 800px) 720px, 100vw"/>
  <img src="/hero-2400.6f7a8b9c.jpg" srcset="/hero-640.7a8b9c0d.jpg 640w, /hero-960.8b9c0d1e.jpg 960w, /hero-1280.9c0d1e2f.jpg 1280w, /hero-1920.0d1e2f3a.jpg 1920w, /hero-2400.6f7a8b9c.jpg 2400w" sizes="(min-width: 800px) 720px, 100vw" alt="A hero" loading="lazy" decoding="async" width="2400" height="1600"/>
</picture>
```

### Source paths

The path in `src` tells bongo where the file is:

- `img/hero.jpg` is relative to `assets/`, as for `<bongo:asset>`.
- `./hero.jpg`, `../hero.jpg`, and `/blog/post/hero.jpg` resolve against the URL of the page, as a browser resolves them, and bongo reads the file from `content/`. For `content/blog/post.md`, which is served at `/blog/post/`, `./hero.jpg` is `content/blog/post/hero.jpg`.

A root-relative path is the URL path that the browser requests, so on a site under `/blog/` it starts with `/blog/`. Thus `{{ post.path }}{{ post.params.cover }}` works in a list of posts. A path outside the site fails the build.

### Attributes

- `src="..."` — the image. Required.
- `sizes="..."` — defaults to `$images.sizes`.
- `widths="640,1280"`, `formats="webp,jpeg"`, `quality="60"` — override `$images` for this image.
- `width`, `height` — default to the size of the source. If you give only one, bongo calculates the other from the aspect ratio.
- `loading` — defaults to `lazy`, or to `eager` when `fetchpriority="high"`.
- `decoding` — defaults to `async`.
- All other attributes, such as `alt`, `class`, and `fetchpriority`, go on the `<img>`.

A `sizes` value that starts with `auto` lets the browser use the width of the image in the layout. Browsers use `auto` only for lazy images, so bongo removes it from eager images.

## Content images

By default, bongo also processes each `<img>` in content whose `src` is a relative path. This includes Markdown images, such as `![A hero](hero.jpg)`, and `<img>` elements that you write in Markdown, HTML, or `.hbs` content. The path resolves against the URL of the page, as for `./` paths.

The `<img>` stays where it is. bongo does not add a `<picture>`, so CSS such as `p > img` still applies. The `<img>` gets:

- a `src`, `srcset`, and `sizes` in the first format in `$images.formats`, which is WebP by default and which every current browser supports,
- its `width` and `height`,
- `loading="lazy"` and `decoding="async"`.

Attributes that you write, such as `width`, `sizes`, or `loading`, stay as you wrote them.

bongo does not change an `<img>` that:

- has a `srcset`,
- is in a `<picture>`,
- has an absolute URL, a root-relative path such as `/img/a.png`, or a `data:` URL in `src`.

To leave all content images as written, set `$images.content` to `false`. To get a `<picture>` with all formats in Markdown, write a `<bongo:image>`. See [@bongo/markdown](/docs/markdown/#images).

## Processing

- bongo makes one file for each width in `widths` that is smaller than the source. If one or more widths are not smaller, bongo makes one file at the width of the source instead. bongo never enlarges an image.
- Files are named `name-width.hash.ext`. The hash comes from the contents of the source, the encoder settings, and the Bun version.
- bongo applies the EXIF orientation of JPEG files and removes the EXIF data, such as GPS positions. It keeps the color profile.
- bongo resizes JPEG, PNG, and WebP files. It copies all other images once under a hashed name, as for `<bongo:asset>`: SVG, GIF, TIFF, AVIF, HEIC, and animated PNG and WebP files. It adds their `width` and `height` when it can read them. For SVG, they come from the `width`, `height`, or `viewBox` attributes.

## Cache

bongo keeps encoded images in `node_modules/.cache/bongo/images`. A rebuild copies unchanged images from there, and encodes only new or changed images. To clear the cache, delete the folder.

bongo records when a build last used each cached file, as the file's modified time. It updates that time at most once a day. At the end of a build, at most once a day, bongo deletes the files that no build has used for 30 days. Set `$images.prune` to another number of days, or to `false` to keep every file.

When two builds run at the same time, and one deletes a file that the other is about to use, the other encodes it again. Thus a prune never breaks a build.

## Images in dev

`bongo dev` does not encode images when it builds. It reads the size of each image and writes the pages, so the first build stays fast. The dev server encodes a file the first time that the browser asks for it, and then serves it from the cache. A browser asks for only one file per image, so most files are never encoded in dev. When you change an image, bongo rebuilds, and the page reloads with the new URLs.

## Errors

A missing image fails the build. The error shows the element and the files that rendered it:

```
Missing "content/blog/post/hero.jpg" for <img src="hero.jpg" alt="">, rendering content/blog/post.md
```

An image path that resolves outside `assets/` or `content/` also fails the build.

`Bun.Image` encodes AVIF only on Apple Silicon M3 or newer Macs and on Windows. If you ask for `avif` on another machine, such as Linux CI, the build fails and says so.

## Image config

The `$images` config field sets the defaults for all images. These are the default values:

```ts [bongo.config.ts]
export default {
	$images: {
		widths: [640, 960, 1280, 1920, 2880],
		formats: ['webp', 'original'],
		quality: { avif: 50, webp: 80, jpeg: 80 },
		sizes: 'auto, 100vw',
		content: true,
		prune: 30,
	},
};
```

- `widths` — the output widths, in pixels. 2880 serves a full-width image on a 1440 pixel screen with a pixel ratio of 2.
- `formats` — `avif`, `webp`, `jpeg`, `png`, or `original`, best first. `original` is the format of each source. Content images use only the first format. `<bongo:image>` puts the last format in its `<img>` as the fallback, and the others in `<source>` elements. Both should be formats that all browsers support. `avif` is not in the defaults, because only some machines can encode it.
- `quality` — from 1 to 100, for AVIF, WebP, and JPEG. Give one number for all of them, or one number for each format. PNG is always lossless.
- `sizes` — the `sizes` of images that do not have one.
- `content` — process `<img>` elements in content.
- `prune` — delete cached images and [rendered images](/docs/rendered-images/#dev-and-cache) that no build has used for this many days, or `false` to keep them all.
