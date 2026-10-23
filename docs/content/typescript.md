---
title: TypeScript
summary: The JSX types that bongo ships for its elements and attributes, and the types it exports for the config, loaders, hooks, and data modules.
group: Reference
order: 7
---

`bongo` ships ambient JSX types for its custom elements and attributes, and exports types for the config and the build.

## JSX types

Extend the bundled config in your `tsconfig.json`:

```json [tsconfig.json]
{
	"extends": "bongo/tsconfig",
	"compilerOptions": {
		// your own settings
	}
}
```

The augmentation adds:

- the `<bongo:asset>`, `<bongo:client>`, `<bongo:image>`, `<bongo:script>`, and `<bongo:style>` intrinsic elements,
- `transition:name` and `transition:animate` on every HTML element,
- `transition:disable` and `prefetch:disable` on anchors.

Or reference the types directly:

```ts
/// <reference types="bongo/jsx" />
```

See [Special elements](/special-elements/), [View transitions](/view-transitions/), and [Opt out](/client-runtime/#opt-out).

## Exported types

Import types from `bongo`:

| Type | Use |
| --- | --- |
| `Config` | The config. Write `export default {…} satisfies Config`. See [Config](/config/#the-config-file). |
| `Loader` | A loader in `$loaders`. See [Loaders](/loaders/). |
| `Build.Transform` | A `$hooks.transform` function. See [Hooks](/hooks/). |
| `Build.Context` | The `ctx` of a hook. |
| `Build.Data` | What the default export of a data module gets when it is a function. See [Data modules](/data-modules/). |
| `Images.Options` | The `$images` config field. See [Image config](/images/#image-config). |
| `Template.Site` | The `$site` config field. Add your own fields to it. See [Define custom `$site` fields](/config/#define-custom-site-fields). |

```ts [content/search.json.ts]
import type { Build } from 'bongo';

export default ({ $pages }: Build.Data) => $pages.map(page => ({ title: page.title, path: page.path }));
```

For `import.meta.env.DEV` and `import.meta.env.PROD` in scripts, reference `bongo/env`. See [Script values](/config/#script-values).

Import the client runtime types from `bongo/client`: `ClientOptions`, `BongoEvent`, and `BongoEventDetails`. See [Client runtime](/client-runtime/).
