# Bongo — end-to-end rolldown design

**Date:** 2026-04-20
**Status:** draft
**Owner:** @lukeed

## Summary

Standardise bongo on **rolldown** as the sole JS bundler and **LightningCSS** as the sole CSS tool, end-to-end: the publish-time build (`/build/`) and the runtime SSG pipeline (`packages/bongo/src/utils/bundler.ts`). Replace the current one-shot bundler API with a two-pass register/flush/resolve surface that enables parallel group builds, stable placeholders, and rolldown HMR in dev. Archive dead trees (`rewrite/`, `packages/bongo-old/`) and stale branches. Swap the test runner to `bun test` and the workspace manifest from pnpm to bun-native.

## Goals

- Rolldown is the only JS bundler anywhere in the project.
- LightningCSS is the only CSS tool — no PostCSS, SCSS, LESS.
- Two-pass rendering for templates so bundle groups can run in parallel and placeholders stay stable across rebuilds (required for HMR).
- HMR in dev via rolldown HMR; fallback to watch-and-full-reload for paths that cannot HMR.
- Bun as the runtime for local dev, CI, and testing. `bun test` replaces vitest.
- No `esbuild` and no `Bun.build` (or other Bun-bundler APIs) in the dependency graph.
- Archive dead trees in place; do not delete history.

## Non-goals

- SCSS/LESS/PostCSS support.
- Supporting Node <22.
- Backwards compatibility with the pre-refactor `bundler.ts` call sites. Breaking changes are explicitly acceptable.
- Preserving `rewrite/` as live code.

## Architecture

Three utility modules under `packages/bongo/src/utils/` drive the asset pipeline:

- **`bundler.ts`** — rolldown wrapper. Owns lifecycle for JS bundling and orchestrates CSS groups via `css.ts`. Exposes `register`, `flush`, `resolve`, `watch`, `hmr`, `reset`. Two-pass-render-friendly.
- **`css.ts`** — thin LightningCSS wrapper. `transform(source, opts)` and `bundle({ entry, … })` via `bundleAsync`. Used both internally by `bundler.ts` for CSS groups and directly for body-content `<style>` blocks.
- **`config.ts`** — locate and load the user's `bongo.config.*`. The TS-loading helper lives here (moved out of `bundler.ts`) and uses runtime detection.

Template rendering lives in `utils/templates.ts` (renamed from `utils/views.ts`). `<style>` / `<link>` / `<script>` partial processing lives in `utils.ts` under `utils.blocks[...]`.

`build.ts` and `dev.ts` orchestrate the two-pass render. The `<style>` and `<script>` partials become synchronous — they call `bundler.register(...)` and return a placeholder token.

### Import convention

All intra-package modules are imported as `import * as name from './name'` and called as `name.method(...)`. No named imports between utility modules. Existing code already uses this in several places; it is normalised across the tree during the refactor.

## Bundler API (`utils/bundler.ts`)

Single call surface:

```ts
// Register an entry (idempotent; same entry + cfg joins the same group).
bundler.register(entry: string, cfg: BundleConfig): Placeholder

// Run all registered groups in parallel. Safe to call repeatedly;
// additional register() calls between flushes form a new pending set.
bundler.flush(): Promise<FlushResult>

// Map a placeholder (from register) back to its built filename.
// Call only after flush(). Throws if the placeholder was not in the
// most recent flush.
bundler.resolve(p: Placeholder): string

// Dev-mode: watch all registered entries; callback fires after each
// rebuild with the set of changed output files. Also drives HMR if
// hmr() is wired.
bundler.watch(cb: (diff: WatchDiff) => void): Unsubscribe

// Dev-mode: hand the bundler an SSE/WS sender so it can push HMR updates
// to the client. Entries that cannot HMR fall through to watch()'s cb
// with { reload: true } and the caller does a full page reload.
bundler.hmr(send: (msg: HmrMessage) => void): void

// Reset everything (used by the dev server on config change).
bundler.reset(): void
```

### Types

```ts
type Placeholder = string & { readonly __brand: unique symbol };

type BundleConfig = {
  kind: 'js' | 'css';
  format?: 'esm' | 'cjs';            // js only
  target?: string | string[];        // js only (e.g. 'es2022')
  targets?: LightningTargets;        // css only (browserslist)
  minify?: boolean;                  // default: !ENV.DEV
  sourceMap?: 'inline' | false;      // default: inline in dev, false in prod
  cssModules?: boolean;              // css only; auto-true for *.module.css
};

// Alias over lightningcss's targets (browserslist query or pre-parsed targets).
type LightningTargets = string | string[] | import('lightningcss').Targets;

type FlushResult = {
  outputs: Map<Placeholder, OutputInfo>;
  warnings: Warning[];
  errors: BuildError[];
};

type OutputInfo = {
  filename: string;                  // relative to $.PUBLIC, hashed
  dependencies: string[];            // for watcher
  exports?: Record<string, string>;  // css-modules class map
};

type Warning = { file?: string; line?: number; column?: number; message: string };
type BuildError = Warning & { frame?: string };

type WatchDiff = {
  changed: Set<Placeholder>;
  reload: boolean;                   // true → caller must full-reload
};

type HmrMessage =
  | { type: 'hmr'; updates: unknown[] }   // rolldown HMR descriptors
  | { type: 'reload' }
  | { type: 'error'; errors: BuildError[] }
  | { type: 'error-clear' };
```

### Grouping

Two entries join the same group iff their `BundleConfig` hashes are equal (all relevant fields — `kind`, `format`, `target`/`targets`, `minify`, `sourceMap`, `cssModules`). JS groups run through `rolldown.rolldown({ input: { [name]: entry, … } }).write(outputOpts)`. CSS groups run one `css.bundle({ entry })` per entry in parallel (LightningCSS does not cross-entry code-split, and bongo does not need it).

### Placeholders

`Placeholder` is an opaque branded string of the form `__BONGO_BUNDLE:<sha256-of-entry-plus-cfg>__`. It is stable across rebuilds — the same `(entry, cfg)` always produces the same placeholder, regardless of which flush produced the contents. This is load-bearing for HMR: pass 1's HTML references remain valid after pass 2 even when the underlying bundle was reproduced by an HMR update.

### Error handling

`flush()` never throws on build errors. It returns `{ outputs, warnings, errors }`. Callers decide fatal vs non-fatal:

- `build.ts` (production) — any non-empty `errors` throws after logging via `log.error`.
- `dev.ts` — errors are serialised and sent to the client over SSE as `{ type: 'error', errors }`; the client mounts an overlay. The next successful flush sends `{ type: 'error-clear' }`.

Warnings are always logged but never fatal.

## CSS (`utils/css.ts`)

All CSS — linked, inline, or module — goes through LightningCSS, never through rolldown's built-in CSS handling.

```ts
export async function bundle(opts: {
  entry: string;
  targets?: LightningTargets;
  minify?: boolean;
  sourceMap?: 'inline' | false;
  cssModules?: boolean;
}): Promise<{
  code: Buffer;
  map?: Buffer;
  exports?: Record<string, string>;
  dependencies: string[];
}>;

export async function transform(opts: {
  source: string | Buffer;
  filename: string;
  targets?: LightningTargets;
  minify?: boolean;
  sourceMap?: 'inline' | false;
  cssModules?: boolean;
}): Promise<{ code: Buffer; map?: Buffer }>;
```

- `bundle()` uses LightningCSS `bundleAsync` — handles `@import` resolution internally.
- CSS modules detection: filename pattern `*.module.css` → `cssModules: true` by default. Class-name map is returned via `exports`.
- `dependencies` is the transitive `@import` list; `bundler.watch` uses it to know when to rebuild a CSS group.
- `targets` sourced from `bongo.config.ts` → `$build.targets` (a browserslist string or array).

## Template rules

### CSS

- `<style src="…"></style>` — **implicitly inline**. Pass 1 registers a CSS entry and rewrites `src` to a placeholder. Pass 2 reads the built file and splices its contents as the element's text content; the `src` attribute is removed from the emitted HTML.
- `<link rel="stylesheet" href="…"/>` — **external**. Pass 1 registers a CSS entry and rewrites `href` to a placeholder. Pass 2 rewrites `href` to `{publicPath}{hashed-filename}`.

### JS

- `<script src="…"></script>` — **external** (matches HTML semantics). Pass 1 registers a JS entry and rewrites `src` to a placeholder. Pass 2 rewrites `src` to `{publicPath}{hashed-filename}`.
- `<script src="…" inline></script>` — **inline** (opt-in via the `inline` boolean attribute). Pass 2 reads the built file and splices its contents as the element's text content; both `src` and `inline` attributes are removed from the emitted HTML.

The rule: tag choice determines inline for CSS (`<style>` is inline, `<link>` is external); for JS an explicit `inline` attribute is required since HTML gives only one tag.

## Two-pass render

Pass 1 — `templates.renderAll(argv)`:

```
for each content file:
  render template via partials/layouts
  during render:
    <style src>, <link rel=stylesheet href>, <script src> call bundler.register(...)
    placeholder token is substituted into the HTML
  produces { path, html, meta, placeholders: Map<Placeholder, SubstitutionRule> }
```

```ts
type SubstitutionRule =
  | { kind: 'external'; tag: 'link' | 'script'; attr: 'href' | 'src' }
  | { kind: 'inline'; tag: 'style' | 'script' };
```

Flush — `bundler.flush()`:

```
in parallel:
  rolldown.rolldown(input).write(outputOpts)   // per JS group
  css.bundle({ entry })                         // per CSS entry
returns { outputs, warnings, errors }
```

Pass 2 — `templates.substitute(pages, bundler, result)`:

```
for each page:
  for each placeholder in page:
    rule = placeholders.get(placeholder)
    output = bundler.resolve(placeholder)
    if rule.kind === 'external':
      replace tag's src/href with `${publicPath}${output.filename}`
    else (inline):
      read file, splice as element content, drop src (and `inline` for <script>)
```

Pass 2 output is then written to `$.PUBLIC`.

## Config loader (`utils/config.ts`)

Replace the broken `require.extensions` monkey-patch with runtime-aware TS loading:

```ts
async function loadModule(file: string): Promise<unknown> {
  let isTs = /\.ts$/.test(file);
  if (!isTs) return import(pathToFileURL(file).href);

  // Bun and Deno strip TS natively
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return import(pathToFileURL(file).href);
  }
  if (typeof (globalThis as any).Deno !== 'undefined') {
    return import(pathToFileURL(file).href);
  }

  // Node path — bundle to temp .mjs, then dynamic import
  let tmp = await bundleConfigToTemp(file);
  try {
    return await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
```

`bundleConfigToTemp` runs a tiny rolldown build over the config file with all `node_modules` externalised, `format: 'esm'`, `minify: false`, outputs to `os.tmpdir()`. Cache-busted by a `?t=…` query so repeat loads in a long-running dev session do not hit the import cache.

No `createRequire`, no `require.extensions`, no CJS interop.

## Dev mode

### Topology

- `dev.ts` owns the HTTP server, the file watcher for template/content files, and the SSE channel to the browser.
- `bundler.ts` owns rolldown's watcher and rolldown's HMR wire. `dev.ts` gives it an SSE sender via `bundler.hmr(send)`.
- One SSE stream, four message kinds: `reload`, `hmr`, `error`, `error-clear`.

### Flow on asset change

```
file change in a bundled entry's graph
  → rolldown watch rebuilds the affected group
  → rolldown computes HMR boundary
  → if HMR-safe:
      bundler emits { type: 'hmr', updates } over SSE
      client applies updates; no page reload
  → else:
      bundler re-runs flush() for affected groups
      bundler emits { type: 'reload' } over SSE
      client reloads
```

### Flow on template/content change

```
dev.ts watcher detects template or content change (outside the bundler graph)
  → dev.ts calls templates.rebuild(path)
  → bundler.reset() is NOT called — assets unchanged
  → dev.ts emits { type: 'reload' } over SSE
```

### Client runtime

Minimal, no deps, injected into dev HTML:

```ts
let es = new EventSource('/__bongo/reload');
es.onmessage = (ev) => {
  let msg = JSON.parse(ev.data);
  if (msg.type === 'reload') location.reload();
  else if (msg.type === 'hmr') applyHmr(msg.updates);
  else if (msg.type === 'error') mountOverlay(msg.errors);
  else if (msg.type === 'error-clear') unmountOverlay();
};
```

`applyHmr` follows rolldown's HMR protocol. If rolldown's protocol does not ship a stable client runtime by the time this lands, the HMR path is gated off and `bundler.hmr()` is a no-op — the public API shape does not change; dev falls back to full reload for everything.

### Error overlay

Full-viewport overlay with file/line/column code frames. Pure CSS-in-JS, no deps. Mounted on `error`, unmounted on `error-clear`. ~1.5 KB unminified.

## Publish-time build (`/build/`)

Already on rolldown. Small audit as part of this refactor:

- Confirm `build/util.ts` externalisation list matches `dependencies`/`peerDependencies`/`optionalDependencies` for each package.
- Add a `build/build.test.ts` smoke test that builds one of the real packages into a temp dir and asserts the output exists + is non-empty + is importable.
- Migrate `build/size.test.ts` (and any other vitest tests under `build/`) to `bun test` — same mechanical rename as the rest.

## Cleanup

### Filesystem

```
git mv rewrite            archive/rewrite
git mv packages/bongo-old archive/bongo-old
```

Add `archive/README.md`:

```md
# archive/

Snapshots of prior iterations. Not built, not published, not part of the
workspace. Kept as reference material.

- rewrite/          — 2023–2024 rewrite; superseded by packages/bongo in PR #9
- bongo-old/        — previous published @lukeed/bongo; superseded by packages/bongo
- build-old.js      — original JS build script
- render.js         — original render entrypoint
- runtime.js        — original runtime
```

### Workspace

Delete `pnpm-workspace.yaml`. Update root `package.json`:

```json
{
  "private": true,
  "workspaces": ["build", "demo123", "packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "bun build/index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/node": "22.13.14",
    "bump": "1.0.0-next.1",
    "sirv": "1.0.19",
    "typescript": "5.9.3"
  }
}
```

- `packages/*` naturally excludes `packages/create-bongo/template`. If `template/` has a package.json at its root, rename it during implementation (e.g. `package.template.json` + `create-bongo` renames on scaffold) or move the template out of `packages/`.
- `archive/` is not listed → bun ignores it.
- `tsconfig.json` gets `"exclude": ["archive/**", "**/node_modules/**"]`.

### Branches

Local:
- `git branch -m bun archive/bun`

Origin (gated on explicit confirmation — do not push without approval):
- Delete closed-PR agent heads: `01KKNCXPQJVP9GVS811CDW9EDR`, `01KKNF4YAECHYASH7AAXHC89XZ`, `01KKPJJWPDT4PZ86A1EKJQNQ4S`, `01KKPKD1JPDHTTM7Q025MTT2EM`.
- Rename `origin/bun` → `origin/archive/bun`.
- Keep `origin/chore/setup`, `origin/chore/structure`, `origin/next`, `origin/rewrite` as-is.

## Testing

### Runner

Remove `vitest`. Use `bun test`. API overlap is complete for the suite's usage — only imports change (`from 'vitest'` → `from 'bun:test'`). Scripts:

```json
"scripts": {
  "test": "bun test",
  "test:watch": "bun test --watch"
}
```

### File map

Co-located with source under `packages/bongo/src/`:

- `utils/bundler.test.ts` (new) — register/flush/resolve, group batching, placeholder stability across rebuilds, error propagation, `reset()` semantics, watch/HMR fallback decision.
- `utils/css.test.ts` (new) — bundle, transform, CSS modules class-name emission, dependencies list, targets derivation.
- `utils/config.test.ts` (expanded) — runtime detection for TS loader (Node bundle-to-temp path, Bun direct-import path, Deno direct-import path).
- `utils/templates.test.ts` (renamed from `views.test.ts`) — two-pass render + substitute; ports existing cases.
- `build.test.ts` (new; thin) — end-to-end on `test/fixtures/basic/`; asserts hashed files, correct HTML substitutions, no unresolved placeholders.
- `dev.test.ts` (new) — fake SSE transport; verify `reload` / `hmr` / `error` messages; verify HMR→fallback path.

### Coverage

Target ≥80% line coverage on `utils/bundler.ts`, `utils/css.ts`, `utils/config.ts`, `utils/templates.ts`. Measured by `bun test --coverage`.

### Fixtures

`packages/bongo/test/fixtures/basic/` — a minimal site with:
- one `<link rel="stylesheet" href="…"/>`
- one `<style src="…"></style>`
- one `<script src="…"></script>`
- one `<script src="…" inline></script>`
- one `*.module.css` import consumed from TS
- a `bongo.config.ts`

Used by `build.test.ts` and `dev.test.ts`.

## Rollout

Sequential PRs; each is green on `bun test` before the next. Any can be reverted without unwinding the others.

1. **Cleanup.** `archive/` moves. `pnpm-workspace.yaml` → root `workspaces`. `tsconfig.json` excludes. Branch renames (origin ops gated on explicit confirmation). No live-code changes.
2. **Test runner swap.** Vitest → `bun test`. Mechanical.
3. **Config loader rework.** Runtime detection + bundle-to-temp for Node. Removes the `require.extensions` bug. Bug-fix class — landable on its own.
4. **Bundler API refactor (two-pass).** `register` / `flush` / `resolve`, placeholder tokens, group batching. Updates `utils.blocks.style` / `utils.blocks.script` and `build.ts` for pass-2 substitution. Breaking change.
5. **LightningCSS integration.** `utils/css.ts`. CSS entries flow through it from `bundler.ts`. Drop `windicss`.
6. **`publicPath` restoration.** Derive from `$site.url`; apply during pass-2 rewrites.
7. **Templates rename + namespace-import normalisation.** `views.ts` → `templates.ts`; enforce `import * as name from './name'` across the tree.
8. **Dev server: watch + full reload.** Rolldown watch wired in; SSE emits `reload` on rebuild. Fallback tier.
9. **Dev server: HMR.** Rolldown HMR through SSE. Error overlay. Separate PR — largest unknown, easiest to revert.
10. **Docs.** Update `readme.md` for the new template rules, LightningCSS story, and `bongo.config.ts` surface.

## Success criteria

- `bun install && bun test` green in CI.
- `bun run build` inside `packages/bongo` produces `index.js` + `index.d.ts` via rolldown.
- `create-bongo` into a scratch dir produces a site that `bongo build` compiles with correct hashed assets, correct inline splicing, correct `publicPath`.
- `bongo dev` serves, watches, reloads; HMR applies for simple JS module edits; CSS-module edits trigger full reload; template edits trigger full reload; a syntax error in any entry shows the overlay and recovers on save.
- Zero occurrences of `esbuild` in `packages/**` or `build/**`.
- Zero occurrences of `Bun.build` or other Bun-bundler APIs in live code.
- `rolldown` and `lightningcss` are the only two build-graph dependencies.

## Open questions

- **Rolldown HMR stability at 1.0-rc.9.** Step 9 depends on the protocol being usable from a custom client. If it is not ready, `bundler.hmr()` is a no-op and dev stays on step 8's full-reload tier until rolldown ships a stable HMR story. No public-API impact.
- **`packages/create-bongo/template`.** Whether the template dir contains its own `package.json` at root (which would collide with `packages/*` workspace resolution). Resolved during cleanup PR: either rename the template's `package.json` to `package.template.json` (CLI renames on scaffold) or move the template outside `packages/`.
- **Browserslist config source.** `$build.targets` is a new surface on `bongo.config.ts`. Default to `'last 2 versions and not dead'` if unset. Document in readme during step 10.
- **`publicPath` derivation.** Derived from `new URL($site.url).pathname` — empty/`/` when the site is served at the domain root, `/blog/` when served at `https://example.com/blog/`. Applied during pass-2 URL rewrite; not applied to inline splices (they have no URL).
