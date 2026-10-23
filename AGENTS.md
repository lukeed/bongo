# bongo

A static site generator: Rolldown for scripts, LightningCSS for styles, tempura templates. The packages live in `packages/`.

## Verify

Before every commit:

1. `bun run build` passes. It goes first: the CLI tests run the built `bin.js`, so a build from another branch makes them test old code.
2. `bun test` passes.
3. `bunx tsc -p .` and `bunx tsc -p build` report no errors.

Done when all four commands exit 0.

## Release

The four packages must share one version, and a `v*` tag publishes all of them.
The owner names the bump type (eg `patch`, `minor`, `major`) and says when to push.

1. Write `docs/content/releases/v{VERSION}.md`, from the PRs merged since the last tag. Copy the frontmatter of the latest release page: `title`, a one-line `summary` with code spans in backticks, `group: Releases`, and `date` set to the release day. A later `date` makes the page a draft, so the docs leave it out. Under `## Features`, `## Fixes`, `## Performance`, and `## Docs`, give each change one line with its PR link. Link docs pages with root paths, such as `/config/#script-values`. Done when the page shows on `/releases/` in `bun docs dev`, and its links resolve.
2. Commit the page to `main`, then run Verify. Done when all four commands exit 0.
3. Run `bun bump {type} --all`. It needs a tree with no changes to tracked files. It versions all four packages and `bump.json`, commits, and adds the signed tag `v{VERSION}`. Done when `git tag -v v{VERSION}` reports a good signature.
4. Push `main`, then the tag. The tag publishes to npm, and a publish cannot be undone, so push it only on the owner's go-ahead.
5. Watch the tag's CI run. Before it publishes, it checks that each package and the release page match the tag. After it publishes, it creates the GitHub release from the page. Done when the run passes, `npm view <package> dist-tags` shows the version for all four packages, and the home page of bongo.build links to the new release. The registry can take a few minutes to show a new version.

## Git

The stash list holds the owner's own work. Leave it as it is: set work aside with a WIP commit instead.

With `merge.autostash` on, git prints "apply stashed changes with git stash pop" after a merge. That hint is wrong here: the autostash lives in `MERGE_AUTOSTASH`, and `git merge --continue` applies it.

## Dev reload

Each open page holds one WebSocket to `/~/reload?id=<run id>`. A WebSocket, because browsers allow six HTTP/1.1 connections per host, and one event stream per tab starved page loads. The run id changes with each server start: the server sends `reload` to a page from an earlier run, and a plain reconnect (for example after a back-forward cache restore) does nothing.
