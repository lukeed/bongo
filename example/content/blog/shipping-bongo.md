---
title: Shipping bongo on Bun Workspaces
date: 2026-03-01
summary: How bongo's monorepo is structured with Bun workspaces, and why we chose that toolchain over alternatives.
tags: bun, architecture, ssg
---

# Shipping bongo on Bun Workspaces

bongo is a monorepo. The core `bongo` package lives alongside `@bongo/markdown` and an `example` site that doubles as a build benchmark. Getting the toolchain right took a few iterations.

## Why Bun workspaces

The alternatives were `pnpm workspaces` and `npm workspaces`. Both work fine, but Bun workspaces gave us three things for free:

1. **Native TypeScript** — no separate compilation step for internal packages. `bongo` imports from `@bongo/markdown` and Bun resolves it directly from source.
2. **Fast installs** — Bun's lockfile format and parallel fetcher are noticeably faster on cold installs.
3. **Built-in test runner** — `bun test` runs the full suite across all workspace packages without configuration.

The workspace root's `package.json` lists all packages under `workspaces`. Bun links them via `node_modules` symlinks on install, so cross-package imports just work.

## The binary

`bongo` ships a single `bin.js` entry point that's called with `bun run`. Internally it delegates to `build()` or `dev()` based on the subcommand. There's no separate compile step — Bun runs the TypeScript directly.

## Release workflow

Publishing uses `bun publish`. Because the package is TypeScript-first, we include `exports` fields for both the raw `.ts` sources (for Bun consumers) and a pre-built `.js` bundle (for Node). The bundle is generated with rolldown — the same tool bongo uses for user assets.

## What this doesn't solve

The one thing Bun workspaces doesn't fully handle yet: running a type-check across all packages in one `tsc` invocation. We work around this with a root `tsconfig.json` using `references` and run `tsc --build` as a separate CI step. It's not seamless, but it works.
