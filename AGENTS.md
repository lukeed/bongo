# bongo

A static site generator: Rolldown for scripts, LightningCSS for styles, tempura templates. The packages live in `packages/`.

## Verify

Before every commit:

1. `bun test` passes.
2. `bunx tsc -p .` and `bunx tsc -p build` report no errors.
3. `bun run build` passes.

Done when all four commands exit 0.

## Git

The stash list holds the owner's own work. Leave it as it is: set work aside with a WIP commit instead.

With `merge.autostash` on, git prints "apply stashed changes with git stash pop" after a merge. That hint is wrong here: the autostash lives in `MERGE_AUTOSTASH`, and `git merge --continue` applies it.

## Dev reload

Each open page holds one WebSocket to `/~/reload?id=<run id>`. A WebSocket, because browsers allow six HTTP/1.1 connections per host, and one event stream per tab starved page loads. The run id changes with each server start: the server sends `reload` to a page from an earlier run, and a plain reconnect (for example after a back-forward cache restore) does nothing.
