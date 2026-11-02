# @bongo/tailwind

> Tailwind CSS for [bongo](https://github.com/lukeed/bongo), built from the classes that your pages use.

## Install

```sh
bun add -d @bongo/tailwind tailwindcss
```

## Usage

Add the plugin to `bongo.config.ts`:

```ts
import { tailwind } from '@bongo/tailwind';

export default {
	$site: { url: 'https://example.com/', title: 'My Site', lang: 'en' },
	plugins: [tailwind()],
};
```

Import Tailwind in a stylesheet, and link it with `<bongo:style src="app.css" />`:

```css
/* assets/app.css */
@import "tailwindcss";
```

The stylesheet gets the utilities of:

- each class name in a `class` attribute of a rendered page,
- each class name in the scripts of the folder of the stylesheet, and
- each file that an `@source` names.

See [the docs](https://bongo.build/tailwind/) for the details.

## License

MIT © [Luke Edwards](https://lukeed.com)
