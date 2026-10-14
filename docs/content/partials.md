---
title: Partials
summary: How to write partials as Handlebars files, modules, or config functions, and how to call them from templates, Markdown, and loaders.
group: Guides
order: 4
---

A partial is a template that you call by name. Put it in `partials/` as a `.hbs`, JavaScript, or TypeScript file, or define it in the `$partials` config field.

## Call a partial

Call a partial with `{{#partial}}` and its `src`. The other attributes become its arguments:

```hbs
{{#partial src="header" }}
{{#partial src="card" title="Hello" }}
```

Each argument value is a JavaScript expression. It can be:

- a quoted string, such as `title="Hello"`,
- a bare value with no spaces, such as `count=3` or `post=$page`,
- a `{…}` map or a `[…]` list, such as `tags=['js', 'css']`,
- a `( … )` group, which holds any expression, spaces included, such as `active=($page.section === 'docs')`.

Other text fails the build with `Cannot read the arguments of "partial"`, and the error quotes the text. For example, `active=$page.section === 'docs'` fails, because a bare value ends at the first space.

The name of a partial is its path in `partials/`, without the extension. `partials/header.hbs` is `header`, and `partials/blog/card.hbs` is `blog/card`. A `src` with the extension, such as `src="card.hbs"`, also works.

An unknown name fails the build with `Unknown "card" partial!`.

## Values

A partial in `partials/` gets its arguments, the values that come from the config (`$site`, `$utils`, `$data`, and `$assets`), and the page values of the page that renders it: `$page`, `$pages`, `$section`, and `$tags`. An argument with the same name wins, so you can pass another page:

```hbs [partials/postmeta.hbs]
<p class="meta">{{ $page.params.date }}</p>
```

```hbs
{{#partial src="postmeta"}}
{{#partial src="postmeta" $page=post}}
```

A partial that a nested partial calls gets the same page values.

Two kinds of partials get no page values:

- A [config partial](#config-partials) gets only its arguments.
- A partial that a [Markdown element](#partials-in-markdown) or a [loader](#partials-in-loaders) calls runs when the content file loads, before any page renders. It gets its arguments and the config values, and `$page` is `undefined`.

## Handlebars partials

A `.hbs` partial is a tempura template. Declare the arguments that it reads with `{{#expect}}`:

```hbs [partials/postmeta.hbs]
{{#expect date, tags }}
<p class="meta">
	<time datetime="{{ date }}">{{ $utils.humanDate(date) }}</time>
	{{#if tags.length}}
	<span class="tags">{{#each tags as (t)}}<span class="tag">{{ t }}</span>{{/each}}</span>
	{{/if}}
</p>
```

`$slot` is always declared, so a partial for a Markdown element can print it with no `{{#expect}}`. See [Partials in Markdown](#partials-in-markdown).

A partial that reads a name it does not declare fails the build, and the error gives the fix:

```
partials/postmeta.hbs reads "date", but does not declare it. Add {{#expect date}} at the top of the partial.
```

See [Templates](/templates/#syntax) for the syntax.

## Module partials

A `.js`, `.mjs`, `.cjs`, or `.ts` file in `partials/` is a module partial. bongo loads it as it loads the config: Rolldown bundles it with its local imports. See [How a build works](/project-layout/#how-a-build-works).

Its default export must be a render function. The function gets the arguments, and returns the HTML as a string or a promise of a string:

```ts [partials/badge.ts]
type Args = { label: string };

export default function (args: Args): string {
	return `<span class="badge">${args.label}</span>`;
}
```

A module that exports no function fails the build with `Partial "badge.ts" must export a render function`.

## Config partials

The `$partials` config field holds programmatic partial functions, keyed by name:

```ts [bongo.config.ts]
export default {
	$partials: {
		greeting(args) {
			return `<p>Hello, ${args.name}</p>`;
		},
	},
};
```

Call it as any other partial: `{{#partial src="greeting" name="Luke"}}`. A `$partials` entry replaces a file partial with the same name.

## Partials in Markdown

With `@bongo/markdown`, a `<bongo:name>` element in Markdown prose calls the partial with that name. Its attributes become the arguments:

```md
<bongo:card title="Hello" count=3 />
```

See [Elements](/markdown/#elements).

## Partials in loaders

A loader can call a partial with `utils.render(partialName, args)`. See [Loader utilities](/loaders/#loader-utilities).
