---
title: CLI
summary: The bongo build and bongo dev commands, their options, debug logs, the output folder rules, incremental builds, and minification.
group: Start
order: 4
---

The `bongo` command has two subcommands. `bongo build` writes the site to the [output folder](#output-folder), `public/` by default. `bongo dev` serves the site and rebuilds it when a file changes.

## Commands

```sh
bongo build
bongo dev
```

| Command | Description |
| --- | --- |
| `bongo build` | Build the site into the output folder. |
| `bongo dev` | Start the dev server, build the site behind it, and rebuild on each change. See [Dev server](/dev-server/). |

When it is done, `bongo build` prints the size of each file in the output folder, and its gzip size. Above 50 files, it prints the total size of each kind of file instead, such as `.html` or `.png`, and lists only the scripts and stylesheets, with their gzip sizes.

## Options

```sh
bongo build -C site --minify
bongo dev -C site --host --port 3000
bongo dev --write
bongo build --outdir web/public
bongo build --debug
bongo build --fresh
bongo build --drafts
```

| Option | Default | Description |
| --- | --- | --- |
| `-C`, `--cwd` | `.` | The project folder. bongo finds the config and the source folders in it. |
| `-H`, `--host` | `localhost` | The host that `bongo dev` binds. A bare `--host`, with no value, exposes the server on your network. |
| `-p`, `--port` | `3000` | The port that `bongo dev` binds. |
| `-o`, `--outdir` | `public` | The folder to write the site to, from the project folder. It wins over [`$build.outdir`](/config/#output-folder). See [Output folder](#output-folder). |
| `-m`, `--minify` | off | Minify the output. See [Minify](#minify). |
| `-d`, `--debug` | off | Log each build stage and its time. See [Debug](#debug). |
| `-w`, `--write` | off | `bongo dev` only. Also write the output to the output folder. See [Output folder](#output-folder). |
| `-f`, `--fresh` | off | Render every page, not only the pages that a change reaches. See [Incremental builds](#incremental-builds). |
| `--drafts` | off; on for `bongo dev` | Build drafts: pages with `draft: true`, or a `date` after the build starts. `--no-drafts` leaves them out. See [Drafts](/content/#drafts). |
| `-v`, `--version` | | Show the version. |
| `-h`, `--help` | | Show the help. |

When you do not give `--port` or `--host`, `bongo dev` uses the `PORT` and `HOST` environment variables, if they are set. If the port is in use, `bongo dev` takes the next free port, up to 10 ports higher.

Both commands set `NODE_ENV` when it is not set: `development` for `bongo dev`, and `production` for `bongo build`. See [Dev or build](/config/#dev-or-build).

An unknown option, or a `--port` that is not a port number, stops the command with an error.

## Run with Bun

The `bongo` command starts with Node. Image processing needs Bun. So does your own code when it calls a Bun API, such as `Bun.markdown` in a `$utils` function or in the config. Run the command through Bun for either one:

```sh
bunx --bun bongo build
bun --bun run build   # for a "build": "bongo build" script
```

Under Node, code that calls a Bun API fails the build, and the error says to run bongo with Bun. See [Images](/images/#bun-runtime).

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

The output folder is `public/` in the project folder. To use another folder, set [`$build.outdir`](/config/#output-folder) in the config, or pass `--outdir`. The flag wins over the config. bongo owns this folder, so do not let another tool write its files there. When the site also needs files from other tools, such as maps or API docs, build to a folder of its own, such as `web/public`, and copy the folders together in your deploy step.

`bongo build` writes over the files that an earlier run left in the output folder, which is much faster than making them again. When it is done, it deletes each file of the last build that it did not write, so no file from an earlier run stays. The record of the last build lists those files, so `bongo build` does not list the folder. Thus a file that something else put in the folder stays, until a build without the record, such as `bongo build --fresh`, lists the folder and deletes it. When the build fails, it empties the output folder and deletes the record, so no part of the failed build stays. A config that fails to load cannot name `$build.outdir`. Then bongo empties the `--outdir` folder, or else the folder of the last good build, and no other folder.

`bongo dev` does not use the output folder. It keeps its output in memory and serves it from there. Thus a `bongo build` that runs at the same time never changes what dev serves, and dev never changes what the build writes.

With `--write`, `bongo dev` also writes its output to the output folder. It empties the folder before the first build. After that, each rebuild deletes only the files that the new build no longer writes. When the config names another `$build.outdir`, dev empties the new folder and writes all of its output there.

bongo never follows a symlink in the output folder. It deletes a symlink that a write or a deletion goes through, and a build that lists the folder deletes each symlink in it. It never deletes the file or folder that a symlink points to. bongo refuses to empty or write over the output folder, and the build fails, when the folder resolves through symlinks to:

- the project root, or a folder above it,
- a folder outside the project,
- `assets/`, `content/`, `data/`, `layouts/`, or `partials/`, or a folder in one of them or that holds one of them,
- the home folder, a folder above it, or `/`.

The error starts with `Refusing to empty the output folder`, and gives the reason.

## Incremental builds

A build renders only the pages that a change reaches. The other pages keep their files from the last build. `bongo build` keeps a record of its last good build in `node_modules/.cache/bongo/memo.json`. `bongo dev` keeps the same record in memory, so each rebuild after a change renders only the pages that the change reaches.

Each build compares the size and the mtime of each source file with the record. It reads and hashes only a file whose size or mtime changed, and compares that hash with the record. A file that changed less than 2 seconds before a build is read again by the next build, since its mtime may not show a second change that soon. A page renders again when:

- its source file changes,
- it reads `$pages`, `$tags`, or `$section`, and a page in that list changes its path, title, summary, section, tags, headings, or frontmatter. A page reads a list when its source, one of its layouts, or a partial that it calls names that list,
- a file that it reads with `$assets.load` changes,
- a script, a stylesheet, an image, or another asset that it links changes, or a module or stylesheet that one of them imports, since the name of the output file changes. `bongo dev` names each script and stylesheet by its entry, not by its content. There, an edit to one renders only the pages that inline it or use its CSS module classes. The other pages reload and get the new file,
- the config has `$hooks.transform`, and an output file is added, deleted, or changes its frontmatter, since the hook gets the list of output files,
- it was a draft by its `date`, and that moment has passed,
- its file in the output folder changed or is gone since the last build.

Every page renders again when the config changes, or a local file that it imports, a file in `data/`, `layouts/`, or `partials/`, the lockfile, the version of bongo, the runtime, `NODE_ENV`, `--minify`, or `--drafts`. [Output files](/output-files/) and [data modules](/data-modules/) render on every build, since they can read every page.

bongo cannot see a change that keeps the size and the mtime of a source file, as `cp -p` or `rsync -t` can make. It also cannot see what a template, a hook, or a loader reads by itself, such as the time, an environment variable, or a file that it opens. A page that uses one keeps its last file until something else makes it render. Use `--fresh` for such a build, as at the turn of a year for a footer that prints the year:

```sh
bongo build --fresh
```

A build that fails empties the output folder, so the next build renders every page. To start over, delete `node_modules/.cache/bongo/memo.json`, or use `--fresh`.

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
- `outdir` — the same as `--outdir`.
- `minify` — the same as `--minify`.
- `debug` — the same as `--debug`.
- `fresh` — the same as `--fresh`.
- `drafts` — the same as `--drafts`.

`dev(options)` starts the dev server, as `bongo dev` does. It resolves after the first build, and the server keeps running. It takes `cwd`, `debug`, `drafts`, `fresh`, `outdir`, `port`, `host`, and `write`, the same as the `bongo dev` options:

```ts
import { dev } from 'bongo';

await dev({ cwd: 'site', port: 3000 });
```
