---
title: "The Nested #each Fix in tempura"
date: 2026-04-10
summary: "How nested #each loops in tempura stopped the outer loop after one pass, and the fix."
tags: tempura, ssg
---

While we built bongo's blog index layout, we found a bug in tempura: an `#each` inside another `#each` stopped the outer loop after its first item. Here is how we found it, and how we fixed it.

## The symptom

A layout like this:

```hbs
{{#each $section as post}}
  {{#each post.tags as tag}}
    {{ post.title }}: {{ tag }}
  {{/each}}
{{/each}}
```

printed the tags of the first post only. The other posts were gone.

## The cause

tempura compiles each template to one JavaScript function. Each `#each` became a `for` loop, with its index and its list in `var` names. A `var` belongs to the whole function, not to the loop. So the inner loop wrote over the index and the list of the outer loop. When the inner loop ended, the outer loop saw an index at its end, and stopped.

## The fix

Each loop now declares its names with `let`, which belongs to the loop block alone. An inner loop gets its own index and list, and the outer loop keeps its own:

```js
// before: one index and one list for the whole function
for (var i = 0, $$a = list; i < $$a.length; i++) { … }

// after: each loop has its own
for (let i = 0, $$a = list; i < $$a.length; i++) { … }
```

We fixed it in tempura, not around it in bongo, and added a test for nested loops. Thus every tempura user gets the fix, not only bongo.
