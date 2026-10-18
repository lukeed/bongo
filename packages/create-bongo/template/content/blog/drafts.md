---
title: Drafts and Scheduled Posts
date: 2026-05-02
summary: A post that bongo dev shows and bongo build leaves out, until its frontmatter says otherwise.
tags: ssg, drafts
draft: true
---

This post is a draft: its frontmatter has `draft: true`. `bongo dev` shows it, with the badge above, so you can read it while you write it. `bongo build` leaves it out: it writes no page for it, and the blog index, `$pages`, and any feed do not list it.

A post with a `date` in the future is a draft too, until a build starts after that date. So a post can wait for its day, and the first build after it publishes the post.

## Publish it

Remove `draft: true`, or set `draft: false`. `draft: false` also publishes a post whose `date` is still to come, such as the page of an event.

## See what a build ships

`bongo build --drafts` builds drafts too, and `bongo dev --no-drafts` leaves them out while dev runs.
