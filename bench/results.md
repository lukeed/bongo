# Bench results

`bun run bench` builds a generated site of 10,000 Markdown pages (`bench/site/`) and the docs site, and runs `bongo dev` on the generated site. After a change that can affect speed or memory, run it on the same machine, and add a row to each table. A row that is much worse than the row above it is a regression to explain before the change merges.

Each row is a median of 5 runs, except for dev, which runs once. All rows use the same bench and the same generated site, so they compare only the build code. "Baseline" is the build code of `main` before #63. From #66 on, the full builds run with `--fresh`, since a repeat build renders only what changed.

Machine: Apple M1 Max (10 cores), 64 GB, macOS (darwin 24.6.0), Bun 1.4.3.

## bench/site/, 10,000 pages

Each run builds over the output of the run before it, as a repeat build does. The sha256 of `public/` must not change: it is `bb8044b9dc500b15` up to #68. From #66 on, it is `8a3eb4b55617cb67`, since scripts name their modules from the site root, not from the folder that the build runs in.

| stage | wall | user | sys | peak RSS |
| --- | --- | --- | --- | --- |
| baseline | 6.92 s | 4.21 s | 19.85 s | 1179 MB |
| #63 stream page writes | 5.90 s | 4.52 s | 15.34 s | 775 MB |
| #64 summarize size report | 4.99 s | 3.92 s | 16.22 s | 672 MB |
| #65 cache date formatters | 4.29 s | 3.26 s | 16.48 s | 576 MB |
| #67 write over public/ | 2.82 s | 3.31 s | 6.60 s | 540 MB |
| #68 free the last build | 2.82 s | 3.35 s | 6.68 s | 519 MB |
| #66 incremental builds | 2.66 s | 3.34 s | 3.55 s | 544 MB |

## docs/

The output hash of the docs site changes with its content, such as the docs edits in #63, #64, and #67, so it is not in this table.

| stage | wall | user | sys | peak RSS |
| --- | --- | --- | --- | --- |
| baseline | 265 ms | 363 ms | 184 ms | 193 MB |
| #63 stream page writes | 271 ms | 370 ms | 192 ms | 196 MB |
| #64 summarize size report | 237 ms | 341 ms | 191 ms | 189 MB |
| #65 cache date formatters | 229 ms | 334 ms | 177 ms | 188 MB |
| #67 write over public/ | 230 ms | 348 ms | 135 ms | 186 MB |
| #68 free the last build | 227 ms | 348 ms | 120 ms | 185 MB |
| #66 incremental builds | 226 ms | 348 ms | 114 ms | 185 MB |

## bongo build after an edit, on bench/site/

The `incremental` target edits the generated site, runs `bongo build`, and undoes the edit. The last run of each step must write the bytes of a `--fresh` build. Before #66, each step is a full build.

Wall time:

| stage | fresh | no change | body edit | title edit | new page | stylesheet edit | layout edit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #68 free the last build | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s |
| #66 incremental builds | 2.52 s | 644 ms | 667 ms | 742 ms | 766 ms | 2.61 s | 2.57 s |

Peak RSS, and the files that the build wrote, of 10,105:

| stage | fresh | no change | body edit | title edit | new page | stylesheet edit | layout edit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #68 free the last build | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all |
| #66 incremental builds | 606 MB · all | 264 MB · 4 | 264 MB · 5 | 306 MB · 205 | 312 MB · 206 | 593 MB · all | 547 MB · all |

The fresh step peaks at 606 MB here, and at 544 MB in the first table, for the same build: the peak RSS of a full build swings by about 60 MB from run to run. A build with no change still writes the 3 bundles and the sitemap: output files render on every build. A title edit renders the 100 pages of its section, since each links its neighbours through `$section`, and each section index and the sitemap, since they read `$pages`.

## bongo dev on bench/site/

Steps: the first build, 3 full rebuilds from an edit to `layouts/html.hbs`, then 3 page edits. From #66 on, each step edits a file for real, since a touch no longer renders anything, and the bench adds 3 stylesheet edits and a new page. Footprint is the memory that Activity Monitor shows. On macOS, RSS also counts memory that the allocator freed, until the system takes it back, so watch the footprint.

| stage | first build | full rebuild | page edit | footprint, first build | footprint, 3rd full rebuild | footprint, end | JS heap, end | RSS, end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 2.70 s | 2.50 s | 0.86 s | 937 MB | 1800 MB | 759 MB | 442 MB | 3263 MB |
| #63 stream page writes | 2.70 s | 2.50 s | 0.85 s | 836 MB | 880 MB | 413 MB | 251 MB | 2483 MB |
| #64 summarize size report | 2.70 s | 2.50 s | 0.83 s | 796 MB | 1399 MB | 1004 MB | 910 MB | 3219 MB |
| #65 cache date formatters | 2.00 s | 1.80 s | 0.87 s | 811 MB | 814 MB | 426 MB | 248 MB | 2747 MB |
| #67 write over public/ | 2.00 s | 1.80 s | 0.83 s | 811 MB | 1146 MB | 517 MB | 251 MB | 2810 MB |
| #68 free the last build | 2.00 s | 1.80 s | 0.83 s | 259 MB | 162 MB | 159 MB | 174 MB | 1441 MB |
| #68, with the steps of #66 | 2.00 s | 1.80 s | 0.82 s | 259 MB | 184 MB | 139 MB | 131 MB | 1554 MB |
| #66 incremental builds | 2.00 s | 1.80 s | 0.17–0.43 s | 280 MB | 248 MB | 240 MB | 165 MB | 1702 MB |

Before #68, the footprint of dev depends on when the garbage collector runs, so those rows swing from run to run.

With the steps of #66, a stylesheet edit and a new page each take 1.80 s on #68. On #66, a stylesheet edit takes 0.17 s and a new page 0.25 s: dev names each stylesheet by its entry, so the edit renders no page. The first page edits warm up the code of an incremental rebuild, so they take 0.40 s, and later ones 0.17 s. The footprint at the end swings too: two more runs of #66 end at 173 MB and 177 MB. Against #68, dev holds about 35 MB more JS heap, the memo of 10,000 pages.
