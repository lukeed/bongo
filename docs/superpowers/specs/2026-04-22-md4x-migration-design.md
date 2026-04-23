# Migrate `@bongo/markdown` from `markdown-it` → `md4x`

Date: 2026-04-22
Package: `packages/plugin.markdown`

## Goal

Swap the Markdown renderer used by `@bongo/markdown` from
[`markdown-it`](https://github.com/markdown-it/markdown-it) to
[`md4x`](https://github.com/unjs/md4x). Expose md4x's `highlighter` option so
consumers can plug in any syntax highlighter (Shiki, Starry Night, hljs, etc.).

## Motivation

- `md4x` is a Zig-backed Markdown renderer with GFM + frontmatter + MDC support
  shipped as a single package. Faster than `markdown-it` and lighter on
  dependencies.
- `markdown-it` has no built-in path for pluggable syntax highlighting that
  matches md4x's callback ergonomics (`(code, block) => string | undefined`).
- Users want to BYO highlighter rather than have the plugin mandate one.

## Public API change

Before:

```ts
import type MarkdownIt from 'markdown-it';
export function markdown(options?: MarkdownIt.Options): Partial<Config>;
```

After:

```ts
import type { HtmlOptions } from 'md4x';
export function markdown(options?: HtmlOptions): Partial<Config>;
```

`HtmlOptions` from md4x is:

```ts
interface HtmlOptions {
  heal?: boolean;         // fix incomplete/streaming markdown
  full?: boolean;         // wrap output in a full HTML document (not useful here)
  highlighter?: CodeBlockHighlighter;
}

type CodeBlockHighlighter = (
  code: string,
  block: {
    start: number;
    end: number;
    lang: string;
    filename?: string;
    highlights?: number[];
  },
) => string | undefined;
```

Returning `undefined` from `highlighter` preserves md4x's default `<pre><code>`
output for that block — mirroring the user's example snippet.

## Implementation

### `packages/plugin.markdown/package.json`

- Remove `dependencies.markdown-it`.
- Remove `devDependencies.@types/markdown-it`.
- Add `dependencies.md4x` at `^0.0.25`.

### `packages/plugin.markdown/src/index.ts`

- Import `renderToHtml` and `type HtmlOptions` from `md4x`.
- Delete the module-level `let mdown: MarkdownIt` singleton and the
  `await import('markdown-it').then(...)` lazy init — `renderToHtml` is a
  direct synchronous function; no init is required.
- Drop the default `{ html: true, linkify: true, typographer: true }` options:
  md4x has no equivalents. Raw HTML passthrough is CommonMark default; GFM
  autolinks are built in; typography/smart-quotes is not supported (acceptable
  behavioral delta).
- Replace `mdown.render(x)` in both call sites (`unpack` inner-slot render and
  the outer `$assets.md` body render) with `renderToHtml(x, options)`. This
  naturally routes user-supplied `highlighter` through slot-inner renders too.
- Keep the `utils.frontmatter(content)` flow unchanged. It is bongo's own
  frontmatter parser; it is independent of the renderer and controls what
  `metadata` the asset exposes.
- Keep the `<bongo:*>` tag parser in `unpack()` unchanged.

### `example/`

- Add `shiki` to `example/package.json` devDependencies. It's the most popular
  themed highlighter and matches the snippet the user provided.
- In `example/bongo.config.ts`, create a single shared Shiki highlighter
  (`await createHighlighter({ themes: ['github-dark'], langs: [...] })`) and
  pass it into `markdown({ highlighter })` using the exact callback shape from
  the task description:

  ```ts
  markdown({
    highlighter(code, block) {
      if (!block.lang) return; // keep md4x default for plain fences
      return highlighter.codeToHtml(code, {
        lang: block.lang,
        theme: 'github-dark',
      });
    },
  });
  ```

- Language list pre-loaded into Shiki: `bash`, `css`, `hbs`, `js`, `ts` —
  every language currently used by fenced blocks in `example/content/`.
- The config must `await` the highlighter's creation. `bongo.config.ts` will
  need to become an async default export (or pre-await at module scope). Pick
  whichever bongo's loader already supports — will verify during implementation.

## Behavioral deltas

These are consequences of the renderer swap, not bugs:

- Smart typography (curly quotes, em-dashes, ellipses) is gone — md4x does not
  implement the markdown-it `typographer` option.
- Some edge-case formatting differences where `markdown-it` and CommonMark/GFM
  diverge (nested emphasis, certain HTML-in-Markdown patterns). Accept these.
- `md4x` ships per-platform NAPI binaries with a WASM fallback. This is the
  first native binary dep in the `@bongo/markdown` package and is worth
  mentioning in release notes.

## Verification

- Run `bun install` at the repo root to refresh the workspace.
- Run `bun run build` in `example/` — must complete without error.
- Spot-check one blog post from `example/content/blog/` that contains code
  fences to confirm HTML is produced and fenced blocks render.
- Temporarily wire a trivial highlighter (e.g. one that wraps code in
  `<pre data-hi="true">…</pre>`) in `example/bongo.config.ts`, rebuild, and
  grep the output to confirm the callback fires. Revert before finishing.

## Out of scope

- Switching frontmatter parsing to `md4x`'s `parseMeta` (changes the shape of
  `metadata`).
- Changing the `<bongo:*>` tag parser.
- Shipping a bundled highlighter or pinning a specific one.
- Adding tests for the plugin (none exist today).
