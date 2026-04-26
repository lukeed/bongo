---
title: Dev Server and HMR Readiness
date: 2026-03-28
summary: Where bongo's dev server stands today — fast full reload via Bun's HTTP server — and the plan for rolldown HMR.
tags: rolldown, bun, performance
---

# Dev Server and HMR Readiness

bongo's dev mode is a work in progress, but it's already useful. Here's where things stand.

## Current implementation

The dev server is a lightweight Bun HTTP server that serves the `public/` output directory. On each file change, it triggers a full rebuild and sends a reload signal to any open browser tabs via a small injected script and a `EventSource` endpoint.

Full rebuild is fast enough to feel acceptable — on the example site, it completes in under 100ms. But it's not HMR.

## What rolldown needs for HMR

True HMR requires the bundler to understand the module graph and emit only the changed modules. rolldown is building toward this: it exposes a stable module graph API and the `hmrUpdate` hook in its Vite-compatible mode.

bongo's current bundler integration is a single-shot build (no watch mode). To support HMR we need to:

1. Keep rolldown in watch mode between rebuilds
2. Intercept `hmrUpdate` events and forward affected module hashes to the browser
3. On the browser side, accept updates and swap modules without a full page reload

Step 3 is the hard part for a static site. Unlike a React app, there's no component tree to surgically update. The pragmatic approach — and likely what bongo will ship first — is "fast module invalidation with page scroll preservation": reload the page but restore the scroll position.

## The injected script

Right now, the dev-reload script bongo injects looks roughly like:

```js
const es = new EventSource('/_bongo/reload');
es.onmessage = () => location.reload();
```

It's 2 lines and it works. The production build strips it. When HMR lands, this endpoint will carry module-level update payloads instead.

## Timeline

HMR is behind an open issue. The blocker is rolldown's watch API stabilising — it's available but marked experimental. Once it's stable, wiring it up should be straightforward.
