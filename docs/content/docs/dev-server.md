---
title: Dev server
summary: How bongo dev serves the site, what it rebuilds on each change, how it handles errors and missing pages, and how it reloads the browser.
group: Runtime
order: 3
---

`bongo dev` starts the HTTP server and runs the initial build behind it. It rebuilds the site when a file changes, and reloads the open pages.

```sh
bongo dev
bongo dev -C site --host --port 3000
```

## Host and port

The server binds `localhost` on port `3000` by default. Change them with `--host` and `--port`, or with the `HOST` and `PORT` environment variables. A bare `--host`, with no value, exposes the server on your network, and the server prints its network URLs. See [CLI](/docs/cli/#options).

When the port is in use, the server tries the next port, up to 10 ports above the one you gave.

## What triggers a rebuild

A change in `assets/`, `layouts/`, `partials/`, or `content/` triggers a rebuild.

## Config and data changes

A change to the config, to any local file that it imports, or to anything in `data/` loads the config and the data again. Then bongo rebuilds every page. You do not need to restart.

If the config or a data file fails to load, the error overlay shows the error, and the last good build keeps serving until you fix it. The same is true for a rebuild that fails.

## What each rebuild updates

- Each rebuild deletes only the files that the new build no longer writes. See [Output folder](/docs/cli/#output-folder).
- [Output files](/docs/output-files/) render again after every change to a page, because they can read every page.
- [Data modules](/docs/data-modules/) run again after every change to a page, to the module, or to a local file that it imports.
- `bongo dev` does not watch `node_modules`. After you update a package that your CSS imports, save the CSS file that imports it, or restart `bongo dev`. See [Packages in @import](/docs/css/#packages-in-import).

## Images in dev

`bongo dev` does not encode images when it builds, so the first build stays fast. The server encodes each image file the first time that the browser asks for it. See [Images in dev](/docs/images/#images-in-dev).

## Not found pages

A path with no matching file gets a `404` status, the same as on a static host. Thus broken links show up during development. The response body is your own 404 page when the build has one: `404.html`, or `404/index.html`, which `content/404.md` produces. To write `404.html`, give the page `url: /404.html`. See [Custom URLs](/docs/content/#custom-urls).

## Reload messages

Each open page keeps one WebSocket to the dev server. Rebuilds push one of these messages to the browser:

| Message | Meaning |
| --- | --- |
| `{ type: 'reload' }` | Successful rebuild. The browser reloads the page. |
| `{ type: 'error', errors }` | The build failed. A full-viewport error overlay mounts. |
| `{ type: 'error-clear' }` | The next successful build. The overlay unmounts, then the browser reloads. |

The `hmr` message type exists in the type union for forward compatibility. Today, file changes trigger a full reload.

When you restart `bongo dev`, a page that an earlier server rendered reloads as soon as it connects to the new server.
