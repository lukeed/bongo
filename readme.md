# bongo

> A static site generator built on Rolldown and LightningCSS.

This repository contains the bongo static site generator, its Markdown plugin, the project scaffolder, and the example site used for development.

## Packages

- [`bongo`](./packages/bongo/readme.md) — core SSG and optional browser runtime.
- [`@bongo/markdown`](./packages/plugin.markdown/readme.md) — Markdown loader plugin.
- [`create-bongo`](./packages/create-bongo/readme.md) — project scaffolding CLI.

## Development

Bun is the primary development tool. Node 24+ is still supported at runtime, but workspace commands use bun.

```sh
bun install
bun test
bun run build
```

Run the example site:

```sh
bun run example dev
```

The package build uses Rolldown and writes the publishable package files in place.
