---
title: The Dev Server
date: 2026-03-28
summary: How bongo dev keeps each build in memory, rebuilds only what a change reaches, and reloads the page.
tags: performance, ssg
---

`bongo dev` serves the site and builds it again when a file changes. Here is how it works today.

## Output in memory

The dev server keeps each build in memory and serves it from there, as Vite does. It does not write the output folder. Thus `bongo build` can run while `bongo dev` runs, and neither one changes the output of the other. To see the dev output as files, run `bongo dev --write`.

## Rebuilds

A rebuild renders only the pages that the change reaches. An edit to one post renders that post, and each page that lists it, such as the blog index. An edit to a layout, a partial, the config, or `data/` renders every page.

Dev names each script and stylesheet by its entry, not by its content. So an edit to a stylesheet keeps its file name, and the pages that link it need no new render.

## Reload

Each open page holds one WebSocket to the dev server. After a good rebuild, the server tells each page to reload. It is a WebSocket, not an event stream: browsers allow only six HTTP/1.1 connections to one host, and an event stream in each open tab blocked page loads.

When a rebuild fails, the page shows an overlay with the error, and the last good build keeps serving. When a fix builds, the page reloads.

## No HMR yet

Dev reloads the whole page. It does not swap modules in place. Most pages of a static site load fast, so a full reload is often enough.
