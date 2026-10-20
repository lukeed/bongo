# Bench

The bench builds a generated site of 10,000 Markdown pages with bongo, as a fresh build, after each kind of edit, and in `bongo dev`. It also builds the docs site, and the same 10,000 pages with Astro.

For each change that was measured, and what each one found, see [the bench history](./results.md).

## Latest numbers

Apple M1 Max (10 cores), 64 GB, macOS (darwin 24.6.0), Bun 1.4.3. The build numbers are from #74, and the dev numbers are from #75.

### bongo build, 10,000 pages

| build | wall | peak RSS | files written |
| --- | --- | --- | --- |
| fresh | 2.31 s | 503 MB | 10,105 |
| no change | 267 ms | 217 MB | 4 |
| body edit | 265 ms | 218 MB | 5 |
| title edit | 351 ms | 282 MB | 205 |
| new page | 345 ms | 280 MB | 206 |
| stylesheet edit | 2.34 s | 589 MB | 10,105 |
| layout edit | 2.35 s | 593 MB | 10,105 |

A body edit renders only its page. A title edit also renders the 100 pages of its section, since each links its neighbours, and each section index and the sitemap, since they list every page. A stylesheet or layout edit renders every page. A build with no change still writes the 3 bundles and the sitemap.

The docs site, 109 files, builds fresh in 224 ms, with a peak RSS of 187 MB.

### bongo dev, 10,000 pages

| step | time | footprint after |
| --- | --- | --- |
| first build | 1.70 s | 306 MB |
| layout edit | 1.60 s | 175 MB |
| page edit | 90–100 ms | 175 MB |
| stylesheet edit | 90 ms | 175 MB |
| new page | 150 ms | 174 MB |

Footprint is the memory that Activity Monitor shows. dev names each stylesheet by its entry, not by its content, so a stylesheet edit renders no page.

### bongo vs Astro

The same 10,000 pages, layouts, and assets, built with Astro 7.4.1 from [`astro/`](./astro). Each row is a median of 5 runs.

| build | wall | peak RSS | output |
| --- | --- | --- | --- |
| bongo, fresh | **2.31 s** | **503 MB** | 10,105 files · 90 MB |
| bongo, no change | **267 ms** | **217 MB** | |
| Astro, fresh, Node 26.11 | 15.47 s | 3066 MB | 10,106 files · 104 MB |
| Astro, fresh, Bun 1.4.3 | 13.45 s | 3338 MB | |
| Astro, no change, Node 26.11 | 9.15 s | 2643 MB | |

A fresh bongo build is 6–7× faster than Astro, with a sixth of its memory. With no change, bongo is about 34× faster: Astro keeps its parsed Markdown in a cache, but it still renders every page.

Both sites have the same table of contents, pager, tags, dates, sitemap, stylesheet, script, view transitions, and prefetch. The stylesheet is an external file in both. bongo highlights code with twinkleplop, and Astro with Shiki, its default.

## The generated site

[`content.ts`](./content.ts) writes `site/content/`: 100 sections of 100 Markdown pages, an index for each section, a home page, and a sitemap. Each page has frontmatter with a title, a summary, a date, and tags, then 2–5 sections of text, lists, tables, quotes, and code blocks. The same page count writes the same bytes on every run.

[`site/`](./site) builds them with the Markdown plugin, code highlighting for 4 languages, a table of contents, a pager, and the client runtime.

## Run it

From the repository root:

```sh
bun install
bun run bench
```

It builds the packages, writes the site, and runs each target. To run only some targets, name them:

```sh
bun run bench site docs
```

| target | what it measures |
| --- | --- |
| `site` | `bongo build --fresh` of the generated site: 1 warmup and 5 runs, with the time and memory of each stage |
| `docs` | `bongo build --fresh` of the docs site, in the same way |
| `incremental` | `bongo build` after each kind of edit, 5 runs each, then a fresh build to check that the bytes match |
| `dev` | `bongo dev`: the first build, and 3 each of layout, page, and stylesheet edits, then a new page |

| option | default | |
| --- | --- | --- |
| `--runs`, `-r` | `5` | runs of each build |
| `--pages`, `-p` | `10000` | pages in the generated site |

To build the same site with Astro, write the content first, then:

```sh
cd bench/astro
bun install
node node_modules/.bin/astro build
```

Run the bench on an idle machine. Other work on the CPU slows the build, but not its CPU time, so a wall time that is much higher than its user and sys times is a sign of load.
