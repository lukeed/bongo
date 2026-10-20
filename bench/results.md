# Bench history

Each row below is a change that can affect speed or memory, measured with `bun run bench` on the same machine. For what the bench builds, how to run it, and the latest numbers, see [the bench readme](./readme.md).

After such a change, run the bench, and add a row to each table. A row that is much worse than the row above it is a regression to explain before the change merges.

Each row is a median of 5 runs, except for dev, which runs once. All rows use the same bench and the same generated site, so they compare only the build code. The first row, "before #63", is `main` at [`780d855`](https://github.com/lukeed/bongo/commit/780d855), the last commit before the first change in these tables. From #66 on, the full builds run with `--fresh`, since a repeat build renders only what changed.

Machine: Apple M1 Max (10 cores), 64 GB, macOS (darwin 24.6.0), Bun 1.4.3.

## bench/site/, 10,000 pages

Each run builds over the output of the run before it, as a repeat build does. The sha256 of `public/` must not change: it is `bb8044b9dc500b15` up to #68. From #66 on, it is `8a3eb4b55617cb67`, since scripts name their modules from the site root, not from the folder that the build runs in. From #76 on, it is `71e146856b298c20`, since tempura 1.0 keeps line breaks in text, and a page body no longer starts with the line break after its frontmatter.

| stage | wall | user | sys | peak RSS |
| --- | --- | --- | --- | --- |
| before #63 | 6.92 s | 4.21 s | 19.85 s | 1179 MB |
| #63 stream page writes | 5.90 s | 4.52 s | 15.34 s | 775 MB |
| #64 summarize size report | 4.99 s | 3.92 s | 16.22 s | 672 MB |
| #65 cache date formatters | 4.29 s | 3.26 s | 16.48 s | 576 MB |
| #67 write over public/ | 2.82 s | 3.31 s | 6.60 s | 540 MB |
| #68 free the last build | 2.82 s | 3.35 s | 6.68 s | 519 MB |
| #66 incremental builds | 2.40 s | 3.02 s | 4.06 s | 508 MB |
| #74 sync tempura fixes | 2.31 s | 3.08 s | 3.47 s | 503 MB |
| #76 use tempura 1.0 | 2.19 s | 2.98 s | 3.66 s | 506 MB |

## docs/

The output hash of the docs site changes with its content, such as the docs edits in #63, #64, and #67, so it is not in this table.

| stage | wall | user | sys | peak RSS |
| --- | --- | --- | --- | --- |
| before #63 | 265 ms | 363 ms | 184 ms | 193 MB |
| #63 stream page writes | 271 ms | 370 ms | 192 ms | 196 MB |
| #64 summarize size report | 237 ms | 341 ms | 191 ms | 189 MB |
| #65 cache date formatters | 229 ms | 334 ms | 177 ms | 188 MB |
| #67 write over public/ | 230 ms | 348 ms | 135 ms | 186 MB |
| #68 free the last build | 227 ms | 348 ms | 120 ms | 185 MB |
| #66 incremental builds | 225 ms | 336 ms | 108 ms | 188 MB |
| #74 sync tempura fixes | 224 ms | 340 ms | 108 ms | 187 MB |
| #76 use tempura 1.0 | 218 ms | 331 ms | 106 ms | 190 MB |

## bongo build after an edit, on bench/site/

The `incremental` target edits the generated site, runs `bongo build`, and undoes the edit. The last run of each step must write the bytes of a `--fresh` build. Before #66, each step is a full build.

Wall time:

| stage | fresh | no change | body edit | title edit | new page | stylesheet edit | layout edit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #68 free the last build | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s | 2.82 s |
| #66 incremental builds | 2.33 s | 246 ms | 246 ms | 334 ms | 330 ms | 2.30 s | 2.24 s |
| #74 sync tempura fixes | 2.28 s | 267 ms | 265 ms | 351 ms | 345 ms | 2.34 s | 2.35 s |
| #76 use tempura 1.0 | 2.14 s | 239 ms | 248 ms | 337 ms | 335 ms | 2.19 s | 2.17 s |

Peak RSS, and the files that the build wrote, of 10,105:

| stage | fresh | no change | body edit | title edit | new page | stylesheet edit | layout edit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #68 free the last build | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all | 519 MB · all |
| #66 incremental builds | 513 MB · all | 213 MB · 4 | 214 MB · 5 | 281 MB · 205 | 286 MB · 206 | 574 MB · all | 571 MB · all |
| #74 sync tempura fixes | 504 MB · all | 217 MB · 4 | 218 MB · 5 | 282 MB · 205 | 280 MB · 206 | 589 MB · all | 593 MB · all |
| #76 use tempura 1.0 | 499 MB · all | 217 MB · 4 | 220 MB · 5 | 280 MB · 205 | 284 MB · 206 | 608 MB · all | 606 MB · all |

The peak RSS of a full build swings from run to run: 478–544 MB in the first table, 513 MB for the same build here. A build with no memo lists `public/`; a build with one reads the list from it, and reads only the sources whose size or mtime changed. The bench lists `public/` once after each build, to count the files that it wrote, so that no listing warms the cache of the folder before a build. A build with no change still writes the 3 bundles and the sitemap: output files render on every build. A title edit renders the 100 pages of its section, since each links its neighbours through `$section`, and each section index and the sitemap, since they read `$pages`.

The #74 row is 15–21 ms slower than #66 for each small build. An A/B of #74 against `main`, in the same kind of session as below, 12 rounds, twice, had #74 4–8 ms slower. An A/A, with the code of #74 in both copies, had the same gap, 4–11 ms. So the copy of the site, not the code, makes the gap. Compiling every template of the bench site and the docs takes 0.12 ms before #74 and 0.14 ms with it.

### Steps within #66

Runs of the whole bench swing by about 15 ms for a build with no change, as much as one step gains. So each step of #66 was also measured against the others in one session: each bundle builds its own copy of the site, the bundles take turns, and each row is the median of 12 rounds.

| step | no change | body edit |
| --- | --- | --- |
| before the steps | 309 ms | 315 ms |
| a full GC only after 1,000 pages render | 294 ms | 301 ms |
| the memo keeps each page's registry digest | 280 ms | 287 ms |
| the size report takes the sizes that the build knows | 266 ms | 273 ms |
| a mark for each asset, not a signature for each page | 261 ms | 267 ms |
| kept pages replay in bulk | 246 ms | 257 ms |
| a smaller memo, 12.5 MB to 7.1 MB | 243 ms | 251 ms |

The last step of #66 skips the scan for transition attributes on a page that has none. It changes no small build, but a `--fresh` build of the site went from 2.87 s to 2.54 s in the same kind of A/B, 9 rounds.

## bongo dev on bench/site/

Steps: the first build, 3 full rebuilds from an edit to `layouts/html.hbs`, then 3 page edits. From #66 on, each step edits a file for real, since a touch no longer renders anything, and the bench adds 3 stylesheet edits and a new page. Footprint is the memory that Activity Monitor shows. On macOS, RSS also counts memory that the allocator freed, until the system takes it back, so watch the footprint.

| stage | first build | full rebuild | page edit | footprint, first build | footprint, 3rd full rebuild | footprint, end | JS heap, end | RSS, end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before #63 | 2.70 s | 2.50 s | 0.86 s | 937 MB | 1800 MB | 759 MB | 442 MB | 3263 MB |
| #63 stream page writes | 2.70 s | 2.50 s | 0.85 s | 836 MB | 880 MB | 413 MB | 251 MB | 2483 MB |
| #64 summarize size report | 2.70 s | 2.50 s | 0.83 s | 796 MB | 1399 MB | 1004 MB | 910 MB | 3219 MB |
| #65 cache date formatters | 2.00 s | 1.80 s | 0.87 s | 811 MB | 814 MB | 426 MB | 248 MB | 2747 MB |
| #67 write over public/ | 2.00 s | 1.80 s | 0.83 s | 811 MB | 1146 MB | 517 MB | 251 MB | 2810 MB |
| #68 free the last build | 2.00 s | 1.80 s | 0.83 s | 259 MB | 162 MB | 159 MB | 174 MB | 1441 MB |
| #68, with the steps of #66 | 2.00 s | 1.80 s | 0.82 s | 259 MB | 184 MB | 139 MB | 131 MB | 1554 MB |
| #66 incremental builds | 1.70 s | 1.50 s | 0.08–0.09 s | 310 MB | 186 MB | 185 MB | 177 MB | 1620 MB |
| #74 sync tempura fixes | 1.70 s | 1.60 s | 0.09–0.10 s | 829 MB | 262 MB | 261 MB | 177 MB | 2184 MB |
| #76 use tempura 1.0, with #75 | 1.60 s | 1.50 s | 0.09–0.10 s | 308 MB | 168 MB | 168 MB | 174 MB | 1567 MB |

Before #68, the footprint of dev depends on when the garbage collector runs, so those rows swing from run to run.

With the steps of #66, a stylesheet edit and a new page each take 1.80 s on #68. On #66, a stylesheet edit takes 0.08 s and a new page 0.14 s: dev names each stylesheet by its entry, so the edit renders no page. Against #68, dev holds about 45 MB more JS heap, the memo of 10,000 pages.

The footprint of the first build is 783–829 MB on #74, and 800–801 MB on `main` before it, in 2 runs each. The rise from 310 MB on #66 came from [`f99d81a`](https://github.com/lukeed/bongo/commit/f99d81a), which kept the whole last build alive in dev until the next build. #75 fixes it.
