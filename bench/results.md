# Bench results

`bun run bench` builds a generated site of 10,000 Markdown pages (`bench/site/`) and the docs site, and runs `bongo dev` on the generated site. After a change that can affect speed or memory, run it on the same machine, and add a row to each table. A row that is much worse than the row above it is a regression to explain before the change merges.

Each row is a median of 5 runs, except for dev, which runs once. All rows use the same bench and the same generated site, so they compare only the build code. "Baseline" is the build code of `main` before #63.

Machine: Apple M1 Max (10 cores), 64 GB, macOS (darwin 24.6.0), Bun 1.4.3.

## bench/site/, 10,000 pages

Each run builds over the output of the run before it, as a repeat build does. The sha256 of `public/` must not change: it is `bb8044b9dc500b15` for every row.

| stage | wall | user | sys | peak RSS |
| --- | --- | --- | --- | --- |
| baseline | 6.92 s | 4.21 s | 19.85 s | 1179 MB |
| #63 stream page writes | 5.90 s | 4.52 s | 15.34 s | 775 MB |
| #64 summarize size report | 4.99 s | 3.92 s | 16.22 s | 672 MB |
| #65 cache date formatters | 4.29 s | 3.26 s | 16.48 s | 576 MB |
| #67 write over public/ | 2.82 s | 3.31 s | 6.60 s | 540 MB |
| #68 free the last build | 2.82 s | 3.35 s | 6.68 s | 519 MB |

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

## bongo dev on bench/site/

Steps: the first build, 3 full rebuilds from an edit to `layouts/html.hbs`, then 3 page edits. Footprint is the memory that Activity Monitor shows. On macOS, RSS also counts memory that the allocator freed, until the system takes it back, so watch the footprint.

| stage | first build | full rebuild | page edit | footprint, first build | footprint, 3rd full rebuild | footprint, end | JS heap, end | RSS, end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 2.70 s | 2.50 s | 0.86 s | 937 MB | 1800 MB | 759 MB | 442 MB | 3263 MB |
| #63 stream page writes | 2.70 s | 2.50 s | 0.85 s | 836 MB | 880 MB | 413 MB | 251 MB | 2483 MB |
| #64 summarize size report | 2.70 s | 2.50 s | 0.83 s | 796 MB | 1399 MB | 1004 MB | 910 MB | 3219 MB |
| #65 cache date formatters | 2.00 s | 1.80 s | 0.87 s | 811 MB | 814 MB | 426 MB | 248 MB | 2747 MB |
| #67 write over public/ | 2.00 s | 1.80 s | 0.83 s | 811 MB | 1146 MB | 517 MB | 251 MB | 2810 MB |
| #68 free the last build | 2.00 s | 1.80 s | 0.83 s | 259 MB | 162 MB | 159 MB | 174 MB | 1441 MB |

Before #68, the footprint of dev depends on when the garbage collector runs, so those rows swing from run to run.
