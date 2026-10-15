---
title: CLI
summary: The bongo build and bongo dev commands, their options, debug logs, the output folder rules, incremental builds, and minification.
group: Start
order: 4
---

The `bongo` command has two subcommands. `bongo build` writes the site to `public/`. `bongo dev` serves the site and rebuilds it when a file changes.

## Commands

```sh
bongo build
bongo dev
```

| Command | Description |
| --- | --- |
| `bongo build` | Build the site into `public/`. |
| `bongo dev` | Start the dev server, build the site behind it, and rebuild on each change. See [Dev server](/dev-server/). |

When it is done, `bongo build` prints the size of each file in `public/`, and its gzip size. Above 50 files, it prints the total size of each kind of file instead, such as `.html` or `.png`, and lists only the scripts and stylesheets, with their gzip sizes.

## Options

```sh
bongo build -C site --minify
bongo dev -C site --host --port 3000
bongo dev --write
bongo build --debug
bongo build --fresh
```

| Option | Default | Description |
| --- | --- | --- |
| `-C`, `--cwd` | `.` | The project folder. bongo finds the config, the source folders, and `public/` in it. |
| `-H`, `--host` | `localhost` | The host that `bongo dev` binds. A bare `--host`, with no value, exposes the server on your network. |
| `-p`, `--port` | `3000` | The port that `bongo dev` binds. |
| `-m`, `--minify` | off | Minify the output. See [Minify](#minify). |
| `-d`, `--debug` | off | Log each build stage and its time. See [Debug](#debug). |
| `-w`, `--write` | off | `bongo dev` only. Also write the output to `public/`. See [Output folder](#output-folder). |
| `-f`, `--fresh` | off | Render every page, not only the pages that a change reaches. See [Incremental builds](#incremental-builds). |
| `-v`, `--version` | | Show the version. |
| `-h`, `--help` | | Show the help. |

When you do not give `--port` or `--host`, `bongo dev` uses the `PORT` and `HOST` environment variables, if they are set. If the port is in use, `bongo dev` takes the next free port, up to 10 ports higher.

An unknown option, or a `--port` that is not a port number, stops the command with an error.

## Run with Bun

The `bongo` command starts with Node. Image processing needs Bun, so run the command through Bun to resize images:

```sh
bunx --bun bongo build
bun --bun run build   # for a "build": "bongo build" script
```

See [Images](/images/#bun-runtime).

## Debug

`--debug` logs each stage of a build and how long it took. The stages are:

- `loading the config and data/`
- `compiling layouts and partials`
- `reading content/`
- `rendering pages`
- `bundling assets`
- `writing pages`
- `minifying html`, with `--minify`
- `listing sizes`, for `bongo build`

Without `--debug`, a stage that is still running after 15 seconds prints `still <stage>` every 15 seconds. Thus a build that waits on something, like a top-level `await` in your config, tells you what it waits on.

## Output folder

`bongo build` writes over the files that an earlier run left in `public/`, which is much faster than making them again. When it is done, it deletes each file that it did not write, so no file from an earlier run stays. When the build fails, it empties `public/`, so no part of the failed build stays.

`bongo dev` does not use `public/`. It keeps its output in memory and serves it from there. Thus a `bongo build` that runs at the same time never changes what dev serves, and dev never changes what the build writes.

With `--write`, `bongo dev` also writes its output to `public/`. It empties the folder before the first build. After that, each rebuild deletes only the files that the new build no longer writes.

bongo deletes a symlink in `public/`, but never the file or folder that it points to. bongo refuses to empty or write over `public/`, and the build fails, when the folder resolves through symlinks to:

- the project root, or a folder above it,
- a folder outside the project,
- `assets/`, `content/`, `data/`, `layouts/`, or `partials/`, or a folder in one of them or that holds one of them,
- the home folder, a folder above it, or `/`.

The error starts with `Refusing to empty the output folder`, and gives the reason.

## Incremental builds

A build renders only the pages that a change reaches. The other pages keep their files from the last build. `bongo build` keeps a record of its last good build in `node_modules/.cache/bongo/memo.json`. `bongo dev` keeps the same record in memory, so each rebuild after a change renders only the pages that the change reaches.

Each build reads every source file, and compares a hash of it with the record. A page renders again when:

- its source file changes,
- it reads `$pages`, `$tags`, or `$section`, and a page in that list changes its path, title, summary, section, tags, headings, or frontmatter. A page reads a list when its source, one of its layouts, or a partial that it calls names that list,
- a file that it reads with `$assets.load` changes,
- a script, a stylesheet, an image, or another asset that it links changes, or a module or stylesheet that one of them imports, since the name of the output file changes. `bongo dev` names each script and stylesheet by its entry, not by its content. There, an edit to one renders only the pages that inline it or use its CSS module classes. The other pages reload and get the new file,
- the config has `$hooks.transform`, and an output file is added, deleted, or changes its frontmatter, since the hook gets the list of output files,
- its file in `public/` changed or is gone since the last build.

Every page renders again when the config changes, or a local file that it imports, a file in `data/`, `layouts/`, or `partials/`, the lockfile, the version of bongo, the runtime, or `--minify`. [Output files](/output-files/) and [data modules](/data-modules/) render on every build, since they can read every page.

bongo cannot see what a template, a hook, or a loader reads by itself, such as the time, an environment variable, or a file that it opens. A page that uses one keeps its last file until something else makes it render. Use `--fresh` for such a build, as at the turn of a year for a footer that prints the year:

```sh
bongo build --fresh
```

A build that fails empties `public/`, so the next build renders every page. To start over, delete `node_modules/.cache/bongo/memo.json`, or use `--fresh`.

## Minify

`--minify` minifies every JavaScript bundle with Rolldown and every stylesheet with LightningCSS, inline ones included. It also minifies the HTML pages with [tdewolff/minify](https://github.com/tdewolff/minify) when its `minify` CLI is on your `$PATH`.

If the `minify` CLI is missing, the build still succeeds. It prints one notice and leaves the HTML as it is. Without `--minify`, bongo minifies nothing.

bongo never minifies [output files](/output-files/) or [data modules](/data-modules/). A data module always writes compact JSON.

## JavaScript API

`build(options)` from `bongo` runs one build, as `bongo build` does, and resolves when the site is written:

```ts
import { build } from 'bongo';

await build({ cwd: 'site', minify: true });
```

- `cwd` — the project folder. Required.
- `minify` — the same as `--minify`.
- `debug` — the same as `--debug`.
- `fresh` — the same as `--fresh`.

`dev(options)` starts the dev server, as `bongo dev` does. It resolves after the first build, and the server keeps running. It takes `cwd`, `debug`, `fresh`, `port`, `host`, and `write`, the same as the `bongo dev` options:

```ts
import { dev } from 'bongo';

await dev({ cwd: 'site', port: 3000 });
```
