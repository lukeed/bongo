---
title: Client runtime
summary: How the bongo/client runtime turns a static site into an SPA, with its options, events, programmatic navigation, stylesheets, and scroll restoration.
group: Runtime
order: 1
---

`bongo/client` turns a statically generated site into a client-navigated SPA. It is optional.

```ts
import { client, navigate, on, off } from 'bongo/client';
```

## Set up

The simplest setup is the `<bongo:client />` element in your layout:

```hbs [layouts/html.hbs]
<bongo:client transitions />
```

At build time, it expands to:

```html
<script type="module">
  import { client } from "/client.D59fAaym.js";
  client({ transitions: true });
</script>
```

The element emits only that script, so you can put it anywhere in `<head>` or `<body>`. Its attributes become the [options](#clientoptions). Multiple `<bongo:client>` tags on a page share one bundled runtime.

If you also need custom event handlers or boot code, keep a separate `<bongo:script>`:

```hbs
<bongo:client transitions />
<bongo:script src="main.ts"></bongo:script>
```

```ts [assets/main.ts]
import { on } from 'bongo/client';

on('bongo:navigated', ({ to }) => {
	console.log('navigated to', to.pathname);
});
```

Or call `client()` yourself:

```ts
import { client } from 'bongo/client';

client({ transitions: true });
```

## Live region

At startup, the runtime adds a hidden `aria-live` region, `<div id="bongo:live">`, at the start of `<body>`. It keeps that element across navigations, and writes the new page title into it after each one. If the page already has an element with that id, the runtime uses it.

## ClientOptions

| Option | Type | Default |
| --- | --- | --- |
| `transitions` | `boolean \| 'fade' \| 'initial' \| 'slide' \| string` | `false` |
| `prefetch` | `boolean \| 'hover' \| 'tap'` | `false` |

### transitions

The view-transition preset:

- `true` or `'fade'` injects a cross-fade keyframe.
- `'slide'` injects a slide keyframe.
- `'initial'` wraps the swap without injecting CSS.
- A custom string only wraps the swap. Your CSS gives the rules.
- Any falsy value turns transitions off.

Opt a link out with `transition:disable`.

### prefetch

Prefetch same-origin links into the in-memory HTML cache, and fetch the new stylesheets of each page into the HTTP cache:

- `true` or `'hover'` fires after the hover settles, or at once on touch.
- `'tap'` fires on `mousedown` or `touchstart`.

Opt a link out with `prefetch:disable`.

See [View transitions](/view-transitions/) for the presets and for build-time transition attributes.

## Events

Subscribe with `on(event, handler)`. It returns an unsubscribe function. Remove a specific handler with `off(event, handler)`.

```ts
on('bongo:navigated', ({ to }) => {
	console.log('navigated to', to.pathname);
});
```

| Event | Detail shape | Fires when |
| --- | --- | --- |
| `bongo:ready` | `{ url: URL }` | Once, immediately after `client()` is called. |
| `bongo:navigate` | `{ to: URL; from: URL }` | A navigation is intercepted, before the fetch. |
| `bongo:replace` | `{ to: URL; from: URL; doc: Document }` | The HTML is fetched and parsed. The swap has not happened yet. |
| `bongo:replaced` | `{ to: URL; from: URL }` | The DOM is swapped. |
| `bongo:navigated` | `{ to: URL; from: URL }` | The navigation is settled. |
| `bongo:error` | `{ to: URL; error: Error }` | The navigation fetch or swap threw. |

## Programmatic navigation

```ts
navigate('/about');
navigate('/old-url', { replace: true });
```

`navigate()` returns `Promise<void>`. It resolves when the navigation and any transition complete.

## Opt out

Force a full-page load:

```html
<a href="/legacy" transition:disable>Legacy dashboard</a>
```

Turn off prefetch without forcing a full-page load:

```html
<a href="/logout" prefetch:disable>Log out</a>
```

A link to a file, such as `/llms.txt` or `/feed.xml`, loads as it would without the client, and prefetch skips it. The client takes a link whose path ends in a folder, in `.html`, or in a name with no file extension, such as `/about` or `/v1.1.0`. When the response to such a link is not HTML, the browser loads it instead.

A script that only changes the URL, with `history.pushState()` or `history.replaceState()`, keeps its page: the client loads nothing, as a tab or a filter that writes its state into the URL expects. Back and forward between such entries of one page also keep it, and the page gets its `popstate` events. Back or forward to an entry of another page loads that page.

## Stylesheets

On navigation, the runtime compares the `<link rel="stylesheet">` and `<style>` elements in the `<head>` of the two pages. It keeps the stylesheets that both pages use. It adds the new stylesheets in the order of the new page, but keeps them disabled, so the current page does not change. When each new stylesheet loads or fails, or after 3 seconds, the swap enables the new stylesheets, replaces `<body>`, and removes the stylesheets that the new page does not use. A view transition starts only after this wait.

- A `<link>` matches by its resolved `href`, its `media`, and its `disabled` attribute. A `<style>` matches by its content and its `media`.
- The runtime does not wait for a stylesheet that does not apply, such as a `disabled` link or a `media` query that does not match.
- The runtime never removes a stylesheet that a script adds after `client()` starts.
- Stylesheets in `<body>` change with the body.

With `prefetch`, the runtime also fetches the new stylesheets of a page before the click. If the server lets the browser reuse them without a new request, for example with a long `max-age` on hashed files, navigation does not wait for them.

## Scroll restoration

`client()` sets `history.scrollRestoration = 'manual'`.

- Back and forward restore the saved `{x, y}` position for that URL.
- Push and replace scroll to the hash element if there is one, or else to `(0, 0)`.

## Browser support

The Navigation API is available in Chrome and Edge. At the time of writing, it is behind a flag or unsupported in Firefox and Safari. If the API is absent, `client()` emits `bongo:ready` and returns without installing navigation interception.

## Types

`bongo/client` also exports the `ClientOptions`, `BongoEvent`, and `BongoEventDetails` types. See [TypeScript](/typescript/).
