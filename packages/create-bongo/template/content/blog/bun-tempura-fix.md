---
title: "The Nested #each Fix in tempura"
date: 2026-04-10
summary: "Tracing and fixing a bug where nested #each loops produced incorrect scoped variable bindings in tempura."
tags: tempura, bun, ssg
---

# The Nested #each Fix in tempura

While building out bongo's blog index layout, we hit a subtle tempura bug: nested `#each` loops were shadowing the outer loop variable in a way that produced garbled output. Here's how we traced it and what the fix looked like.

## The symptom

A layout like this:

```hbs
{{#each $section as (post)}}
  {{#each post.tags as (tag)}}
    {{ post.title }} — {{ tag }}
  {{/each}}
{{/each}}
```

Would output `{{ post.title }}` as the _inner_ loop's current item instead of the outer `post`. The outer binding was being lost the moment the inner `#each` opened its scope.

## Tracing the bug

tempura compiles templates to a small intermediate representation before generating output. The scoped variable introduced by `as (name)` is stored in a flat environment object, keyed by name. The bug: when the inner `#each` opened, it _replaced_ the outer binding rather than extending the environment. Closing the inner loop then restored the replaced slot — but the outer variable slot was already gone.

## The fix

The fix was to make the environment a proper stack. Each `#each` block pushes a new frame; closing the block pops it. Inner bindings shadow outer ones correctly, and the outer binding is restored on pop.

```ts
// before: flat env object, mutated in place
env[name] = item;

// after: frame stack, push/pop
env.push({ [name]: item });
// ... render children ...
env.pop();
```

The change was upstreamed to tempura directly rather than worked around in bongo. Fewer than 20 lines changed; all existing tests passed and the new regression test covers the nested case.

## Why this matters for bongo

bongo's blog index layout uses exactly this pattern — iterate `$section`, then within each post iterate `post.tags` for the tag pills. Without the fix, tag rendering was corrupting the post title. The upstream fix means any tempura user benefits, not just bongo.
