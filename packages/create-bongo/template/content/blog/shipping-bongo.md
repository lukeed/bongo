---
title: Shipping bongo on Bun Workspaces
date: 2026-03-01
summary: How bongo's monorepo is laid out with Bun workspaces, and how a release goes to npm.
tags: bun, architecture, ssg
---

bongo is a monorepo. The `bongo` package lives next to `@bongo/markdown`, `@bongo/feed`, and `create-bongo`. The docs site and an example site live there too. The toolchain took a few tries to get right.

## Why Bun workspaces

The other choices were pnpm and npm workspaces. Both work, but Bun gave us three things with no setup:

1. **TypeScript as it is**: Bun runs the TypeScript sources and the tests with no compile step.
2. **Fast installs**: cold installs are much faster.
3. **A test runner**: `bun test` runs the tests of every package.

The root `package.json` lists each package under `workspaces`. Bun links them into `node_modules`, so imports between packages work.

## The build

`bun run build` bundles each package with Rolldown, the tool that bongo also uses for your scripts. Each package ships plain JavaScript and its type declarations, so bongo runs in Bun, Deno, and Node 24 or later. The `bongo` command is a small `bin.js` that starts with Node.

Type checks are two plain runs: `bunx tsc -p .` for the packages, and `bunx tsc -p build` for the build scripts.

## Releases

The four packages share one version. `bun bump <type> --all` sets the new version in each package, commits it, and adds a signed tag. A pushed tag starts CI. It checks that each package and the release notes match the tag, publishes each package to npm with provenance, and makes the GitHub release from the release notes.
