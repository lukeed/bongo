---
title: CLI
summary: The bongo build and bongo dev commands, their options, debug logs, the output folder rules, and minification.
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

## Options

```sh
bongo build -C site --minify
bongo dev -C site --host --port 3000
bongo dev --write
bongo build --debug
```

| Option | Default | Description |
| --- | --- | --- |
| `-C`, `--cwd` | `.` | The project folder. bongo finds the config, the source folders, and `public/` in it. |
| `-H`, `--host` | `localhost` | The host that `bongo dev` binds. A bare `--host`, with no value, exposes the server on your network. |
| `-p`, `--port` | `3000` | The port that `bongo dev` binds. |
| `-m`, `--minify` | off | Minify the output. See [Minify](#minify). |
| `-d`, `--debug` | off | Log each build stage and its time. See [Debug](#debug). |
| `-w`, `--write` | off | `bongo dev` only. Also write the output to `public/`. See [Output folder](#output-folder). |
| `-v`, `--version` | | Show the version. |
| `-h`, `--help` | | Show the help. |

When you do not give `--port` or `--host`, `bongo dev` uses the `PORT` and `HOST` environment variables, if they are set.

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

Without `--debug`, a stage that is still running after 15 seconds prints `still <stage>` every 15 seconds. Thus a build that waits on something, like a top-level `await` in your config, tells you what it waits on.

## Output folder

`bongo build` empties `public/` when it starts, before it loads the config. Thus no file from an earlier run stays.

`bongo dev` does not use `public/`. It keeps its output in memory and serves it from there. Thus a `bongo build` that runs at the same time never changes what dev serves, and dev never changes what the build writes.

With `--write`, `bongo dev` also writes its output to `public/`. It empties the folder before the first build. After that, each rebuild deletes only the files that the new build no longer writes.

bongo deletes a symlink in `public/`, but never the file or folder that it points to. bongo refuses to empty `public/`, and the build fails, when the folder resolves through symlinks to:

- the project root, or a folder above it,
- a folder outside the project,
- `assets/`, `content/`, `data/`, `layouts/`, or `partials/`, or a folder in one of them or that holds one of them,
- the home folder, a folder above it, or `/`.

The error starts with `Refusing to empty the output folder`, and gives the reason.

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

`dev(options)` starts the dev server, as `bongo dev` does. It resolves after the first build, and the server keeps running. It takes `cwd`, `debug`, `port`, `host`, and `write`, the same as the `bongo dev` options:

```ts
import { dev } from 'bongo';

await dev({ cwd: 'site', port: 3000 });
```
