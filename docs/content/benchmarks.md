---
title: Benchmarks
summary: How fast bongo builds a site of 10,000 Markdown pages, after each kind of edit and in bongo dev, and how it compares with Astro.
group: Start
order: 5
---

bongo builds a site of 10,000 Markdown pages in 2.2 seconds, about 6× faster than Astro, with a sixth of its memory. A rebuild after an edit renders only the pages that the edit reaches, so most edits build in about a quarter of a second.

These numbers come from the [bench](https://github.com/lukeed/bongo/tree/main/bench) in the bongo repository, on an idle Apple M1 Max (10 cores) with 64 GB of memory, macOS, and Bun 1.4.3. Each number is the median of 5 runs, except for `bongo dev`, which runs once.

## The site

The bench writes a site of 100 sections of 100 Markdown pages, with an index for each section, a home page, and a sitemap. Each page has a title, a summary, a date, and tags, then text, lists, tables, quotes, and code blocks. The layouts add a table of contents, a pager, tags, the stylesheet, a script, and the [client runtime](/client-runtime/) with view transitions and prefetch. The [Markdown plugin](/markdown/) highlights the code in 4 languages.

## bongo build

| build | time | peak memory | files written |
| --- | --- | --- | --- |
| fresh | 2.19 s | 506 MB | 10,105 |
| no change | 239 ms | 217 MB | 4 |
| body edit | 248 ms | 220 MB | 5 |
| title edit | 337 ms | 280 MB | 205 |
| new page | 335 ms | 284 MB | 206 |
| stylesheet edit | 2.19 s | 608 MB | 10,105 |
| layout edit | 2.17 s | 606 MB | 10,105 |

A body edit renders only its page. A title edit also renders the 100 pages of its section, since each one links its neighbours, and each section index and the sitemap, since they list every page. A stylesheet or layout edit renders every page. See [Incremental builds](/cli/#incremental-builds).

This docs site, 109 files, builds in 218 ms.

## bongo dev

| step | time | memory after |
| --- | --- | --- |
| first build | 1.60 s | 308 MB |
| layout edit | 1.50 s | 168 MB |
| page edit | 88–95 ms | 168 MB |
| stylesheet edit | 87–89 ms | 168 MB |
| new page | 151 ms | 168 MB |

Memory is the footprint that Activity Monitor shows. `bongo dev` names each stylesheet by its entry, not by its content, so a stylesheet edit renders no page. See [Dev server](/dev-server/).

## bongo and Astro

The bench also builds the same pages, layouts, and assets with Astro 7.4.1.

| build | time | peak memory |
| --- | --- | --- |
| bongo, fresh | **2.19 s** | **506 MB** |
| bongo, no change | **239 ms** | **217 MB** |
| Astro, fresh, Node 26.11 | 14.05 s | 2,970 MB |
| Astro, fresh, Bun 1.4.3 | 12.04 s | 3,082 MB |
| Astro, no change, Node 26.11 | 7.69 s | 2,735 MB |

A fresh build is about 6× faster than Astro: 5.5× on Bun, and 6.4× on Node. With no change, bongo is about 32× faster: Astro keeps its parsed Markdown in a cache, but it still renders every page.

Both sites have the same table of contents, pager, tags, dates, sitemap, stylesheet, script, view transitions, and prefetch. bongo highlights code with twinkleplop, and Astro with Shiki, its default. bongo writes 10,105 files, 90 MB, and Astro writes 10,106 files, 104 MB.

## Run it

From the bongo repository:

```sh
bun install
bun run bench
```

See the [bench readme](https://github.com/lukeed/bongo/blob/main/bench/readme.md) for each target and option, the Astro build, and the [history](https://github.com/lukeed/bongo/blob/main/bench/results.md) of each change that was measured.
