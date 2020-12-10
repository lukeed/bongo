# svelte-partial-play

> playground for partial hydration w/ svelte

Notes / Thoughts / WTF: https://gist.github.com/lukeed/86ef825baca9b4707189bd91fd63db18

## Setup

```sh
# install
$ pnpm install

# run demo server
$ node build/node.js
```

> **Important:** Must be Node 12+ for native ESM

## Build

You sure?

I included pre-built files because the current setup is non-deterministic.
The `Counter.svelte` is built _only_ for DOM _or_ for SSR – never both.

This means the server either dies instantly, or it runs and the DOM can never hydrate. Fun~

If you want to anyway:

```sh
$ node build.js
```

Good luck
