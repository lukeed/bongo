---
title: View transitions
summary: How to name and animate elements across page navigations with transition attributes and the transition presets of the client runtime.
group: Runtime
order: 2
---

bongo has two parts for view transitions. At build time, it turns `transition:name` and `transition:animate` attributes into CSS. At run time, the [client runtime](/client-runtime/) wraps each navigation in a view transition.

## Turn on transitions

Give the `transitions` option to the client runtime:

```hbs
<bongo:client transitions />
<bongo:client transitions="slide" />
```

| Value | Effect |
| --- | --- |
| `true`, `'fade'` | Wraps the swap, and injects a cross-fade keyframe. |
| `'slide'` | Wraps the swap, and injects a slide keyframe. |
| `'initial'` | Wraps the swap without injecting CSS. |
| any other string | Wraps the swap only. Your CSS gives the rules. |
| any falsy value | Turns transitions off. This is the default. |

See [ClientOptions](/client-runtime/#clientoptions).

## Name elements

Add `transition:name` and `transition:animate` to HTML elements in a layout or a partial. bongo rewrites them at build time:

```hbs
<header transition:name="site-header">...</header>
<nav transition:name="nav" transition:animate="slide">...</nav>
```

- `transition:name="NAME"` — bongo removes it from the element, and merges `view-transition-name: NAME` into the element's `style` attribute.
- `transition:animate="KEYFRAME"` — needs a named `@keyframes KEYFRAME` in your CSS. bongo injects a `<style data-bongo-transitions>` block in `<head>` that wires the keyframe to the matching view-transition pseudo-elements.

If `transition:animate` is present without `transition:name`, bongo generates a name.

For the example above, your CSS gives the `slide` keyframe:

```css
@keyframes slide {
	from { transform: translateX(16px); }
	to { transform: none; }
}
```

bongo writes the `<nav>` as:

```html
<nav style="view-transition-name: nav">...</nav>
```

and adds this rule to the `<style data-bongo-transitions>` block:

```css
::view-transition-old(nav),::view-transition-new(nav){animation-name:slide}
```

## Opt a link out

A link with `transition:disable` forces a full-page load, with no transition:

```html
<a href="/legacy" transition:disable>Legacy dashboard</a>
```

## Types

The TypeScript types of bongo add `transition:name` and `transition:animate` to every HTML element, and `transition:disable` to anchors. See [TypeScript](/typescript/).
