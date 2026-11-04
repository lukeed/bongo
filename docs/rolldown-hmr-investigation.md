# Rolldown HMR — bongo investigation

**Status:** BLOCKED on rolldown 1.0.0-rc.16.
**Date:** 2026-04-21.

Bongo's dev server emits `{ type: 'reload' }` SSE messages on any asset/content change. The client runtime injected by `build.ts` does `location.reload()` on those. The `HmrMessage` union in `utils/bundler.ts` already reserves a `{ type: 'hmr', updates: unknown[] }` variant, but nothing produces it — the browser handler `console.warn`s and ignores.

This document captures why real HMR can't be wired today and what would unblock it.

## What rolldown rc.16 offers

HMR-related APIs all live in `rolldown/experimental`, not the stable `rolldown` export.

### `DevEngine`

`DevEngine.create(inputOptions, outputOptions?, devOptions?)` — a new class designed to power Vite's dev server mode.

- `devOptions.onHmrUpdates` — callback fired per file change with `{ updates: BindingClientHmrUpdate[], changedFiles: string[] }`.
- `engine.invalidate(file)` → `Promise<BindingClientHmrUpdate[]>` — manually trigger an HMR update for a file.
- `engine.registerModules(clientId, modules[])` — tells the engine which modules a given browser client has loaded.
- `engine.removeClient(clientId)` — tear down tracking for a disconnected client.
- `engine.compileEntry(moduleId, clientId)` — lazily compile a module on-demand; returns JS patch code.

### `BindingHmrUpdate`

Discriminated union returned by the callbacks above:

```ts
{ type: 'Patch'; code: string; filename: string; sourcemap?: string; hmrBoundaries: BindingHmrBoundaryOutput[] }
| { type: 'FullReload'; reason?: string }
| { type: 'Noop' }
```

The `Patch` variant carries pre-compiled JS patch code ready to `eval()` in the browser. Client-transport-agnostic at the delivery layer — you'd pipe it over SSE/WebSocket yourself.

### `DevRuntime`

`rolldown/experimental/runtime-types` declares a `DevRuntime` type with `applyUpdates`, `registerModule`, `loadExports`, etc. **But the package export has only a `types` key — there is no corresponding `.mjs` implementation shipped.** `DevRuntime` is a type declaration with no concrete JS to serve to the browser.

## Why this is blocked for bongo

### 1. `DevEngine` is incompatible with the flush-based build model

`DevEngine` replaces `rolldown()` entirely. It requires:

- Running as a persistent daemon (`engine.run()`).
- The browser runtime calling back over a separate channel (`hmr:module-registered` messages from `DevRuntime`) to tell the engine which modules it knows about.
- HMR boundary detection requires `import.meta.hot.accept()` calls in source modules — without them, the engine always emits `{ type: 'FullReload' }`. The `Patch` type is only producible when rolldown can find accept boundaries.

Bongo's current model is: `bundler.flush()` → one-shot `rolldown()` build → write files to disk → browser loads them as normal static HTML+JS. The `DevEngine` model is fundamentally different: it keeps modules in-memory, serves them unbundled one-at-a-time via a module runner, and patches individual module registrations in the browser runtime. Wiring it alongside or on top of the current flush-based pipeline is not possible without replacing it.

### 2. No shipped `DevRuntime` implementation to serve to browsers

The type stub at `rolldown/experimental/runtime-types` declares `DevRuntime`, but no `.mjs` is shipped for the browser. Bongo would need to implement the browser module registry from scratch: `registerModule`, `applyUpdates`, `loadExports`, and the `Messenger` protocol for `hmr:module-registered` messages. That's non-trivial.

### 3. `BindingHmrUpdate.Patch` protocol requires module-runner-format output

`Patch.code` is compiled via `moduleRunnerTransform` — an OXC-based transform that rewrites modules into a form compatible with rolldown's `DevRuntime` module registry. Bongo's current output format (standard ESM files written to disk and served statically) is completely different. You can't take a `Patch.code` string and inject it into a page that loaded standard ESM bundles.

### 4. Rolldown's stable `watch()` API exposes no HMR update objects

The stable `RolldownWatcher` (from the non-experimental `rolldown` export) fires `event` / `change` / `restart` / `close` events only. There is no `updates` payload. HMR patch data only comes from `DevEngine.invalidate()` or `DevOptions.onHmrUpdates`.

## What would unblock this

One of:

1. Rolldown ships a stable `DevEngine` API (out of `experimental`, with changelog / semver commitment).
2. Rolldown ships an actual `DevRuntime` JS implementation suitable for serving to browsers (not just type stubs).
3. Rolldown exposes HMR update objects on the existing `watch()` watcher without requiring the full `DevEngine` + module-runner pipeline.

None of these are present in rc.16. The comment already in `bundler.ts` accurately describes the situation; it remains true at rc.16, just with more surface area visible.

## What's partially usable today (not enough)

`engine.invalidate()` returns HMR updates, and the update union's `FullReload` variant could trivially be mapped to bongo's existing `{ type: 'reload' }`. But using this requires adopting `DevEngine` as the build engine, which breaks everything else.

## Revisit

Check back on each rolldown release. Specifically watch for:

- `DevEngine` or equivalent moving out of `rolldown/experimental`.
- A shipped `DevRuntime.mjs` (or equivalent) with a documented wire protocol.
- Any addition to `watch()` event payloads carrying per-module patch data.
