---
title: About
summary: About the bongo static site generator — who it's for, design goals, and what it deliberately avoids.
---

# About bongo

bongo is an experimental static site generator written in TypeScript, powered by [Bun](https://bun.sh), and built for the kind of site that doesn't need a server.

## Who it's for

If you're building a blog, a documentation site, a marketing page, or a portfolio — bongo is a good fit. If you need user authentication, personalised content, or real-time data, you probably want something else (or a static frontend backed by an API).

## Design goals

- **Fast by default** — rolldown and LightningCSS handle bundling natively in Rust; builds are measured in milliseconds
- **Small surface area** — no runtime dependencies in output, no magic conventions to memorise
- **TypeScript-native** — the config is a `.ts` file, plugins are typed, Bun runs everything without a compile step
- **Plugin system** — loaders can transform any file extension into HTML; the markdown plugin is just a loader

## Non-goals

bongo deliberately doesn't include:

- A component model or UI framework
- Server-side rendering or edge functions
- A built-in CMS or content API
- Hot module replacement (it's on the roadmap, but not a v1 requirement)

## Architecture

The build runs in two passes. Walk 1 scans content, runs loaders, and compiles `.hbs` bodies with limited context. Walk 2 renders layouts with the full page registry — `$pages`, `$section`, `$tags` — available. Assets are bundled in parallel and placeholders are substituted in a final pass.

## Source

The source lives on [GitHub](https://github.com/lukeed/bongo). Contributions welcome.
