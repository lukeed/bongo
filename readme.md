# bongo

> A static site generator built on Rolldown and LightningCSS.

This repository contains the bongo static site generator, its Markdown and feed plugins, the project scaffolder, the example site used for development, and the docs site at [bongo.build](https://bongo.build).

## Packages

- [`bongo`](./packages/bongo/readme.md) — core SSG and optional browser runtime.
- [`@bongo/markdown`](./packages/plugin.markdown/readme.md) — Markdown loader plugin.
- [`@bongo/feed`](./packages/plugin.feed/readme.md) — RSS and Atom feed plugin.
- [`create-bongo`](./packages/create-bongo/readme.md) — project scaffolding CLI.

## Development

Bun 1.4+ is the primary development tool. Node 24+ is still supported at runtime, but workspace commands use bun.

```sh
bun install
bun test
bun run build
```

Run the example site:

```sh
bun run example dev
```

Run the docs site, in `docs/`:

```sh
bun run docs dev
```

The package build uses Rolldown and writes the publishable package files in place.
