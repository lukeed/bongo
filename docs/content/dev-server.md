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

The server binds `localhost` on port `3000` by default. Change them with `--host` and `--port`, or with the `HOST` and `PORT` environment variables. A bare `--host`, with no value, exposes the server on your network, and the server prints its network URLs. See [CLI](/cli/#options).

When the port is in use, the server tries the next port, up to 10 ports above the one you gave.

## What triggers a rebuild

A change in `assets/`, `layouts/`, `partials/`, or `content/` triggers a rebuild.

## Config and data changes

A change to the config, to any local file that it imports, or to anything in `data/` loads the config and the data again. Then bongo rebuilds every page. You do not need to restart.

A workspace package, or any package linked into `node_modules` from outside it, counts as a local file. When you rebuild or edit it, the config loads again with the new code.

If the config or a data file fails to load, the error overlay shows the error, and the last good build keeps serving until you fix it. The same is true for a rebuild that fails. If the first build fails, there is no good build yet: `bongo dev` keeps running, and answers each request with a page that shows the error. When a fix builds, that page reloads.

## Drafts

`bongo dev` builds [drafts](/content/#drafts), so you see a page while you write it. `bongo dev --no-drafts` leaves them out, as `bongo build` does. When the `date` of a scheduled page passes, the next rebuild marks it as no draft.

## Output in memory

The dev server keeps each build in memory and serves it from there, as Vite does. It does not read or write the output folder. Thus you can run `bongo build` while `bongo dev` runs: neither one changes the output of the other.

To see the dev output as files, run `bongo dev --write`. Then dev also writes its output to the output folder, `public/` by default. See [Output folder](/cli/#output-folder).

The dev server serves a file that bongo only copies from `content/`, such as a PDF, from its source. Thus an edit to it shows at once.

## What each rebuild updates

- Each rebuild renders only the pages that the change reaches. See [Incremental builds](/cli/#incremental-builds).
- Scripts and stylesheets keep their file names, since `bongo dev` names them by their entry, not by their content. Thus an edit to one renders only the pages that inline it or use its CSS module classes. The other pages reload and get the new file.
- Each rebuild drops only the files that the new build no longer writes.
- [Output files](/output-files/) render again after every change to a page, because they can read every page.
- [Data modules](/data-modules/) run again after every change to a page, to the module, or to a local file that it imports.
- `bongo dev` does not watch the packages that your CSS imports from `node_modules`. After you update one, save the CSS file that imports it, or restart `bongo dev`. See [Packages in @import](/css/#packages-in-import).

## Images in dev

`bongo dev` does not encode images when it builds, so the first build stays fast. The server encodes each image file the first time that the browser asks for it. See [Images in dev](/images/#images-in-dev).

## Not found pages

When `$site.url` has a subpath, such as `https://example.com/blog/`, `bongo dev` serves the site under `/blog/`, as a host does, and redirects `/` there.

A path with no matching file gets a `404` status, the same as on a static host. Thus broken links show up during development. The response body is your own 404 page when the build has one: `404.html`, or `404/index.html`, which `content/404.md` produces. To write `404.html`, give the page `url: /404.html`. See [Custom URLs](/content/#custom-urls).

## Reload messages

Each open page keeps one WebSocket to the dev server. Rebuilds push one of these messages to the browser:

| Message | Meaning |
| --- | --- |
| `{ type: 'reload' }` | Successful rebuild. The browser reloads the page. |
| `{ type: 'error', errors }` | The build failed. A full-viewport error overlay mounts. |
| `{ type: 'error-clear' }` | The next successful build. The overlay unmounts, then the browser reloads. |

The `hmr` message type exists in the type union for forward compatibility. Today, file changes trigger a full reload.

When you restart `bongo dev`, a page that an earlier server rendered reloads as soon as it connects to the new server.
