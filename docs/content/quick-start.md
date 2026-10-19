---
title: Quick start
summary: Create a bongo site with create-bongo, or add bongo to a project by hand, then run the dev server and build the site.
group: Start
order: 2
---

Create a new site with `create-bongo`, or add bongo to an existing project by hand. Both paths end with a dev server on your machine and a built site in `public/`.

## Create a site

Give `create-bongo` the name of the new folder:

```sh
bun create bongo my-site
```

Install the packages and start the dev server:

```sh
cd my-site
bun install
bun run dev
```

The dev server prints its URL, which is `http://localhost:3000/` by default. See [Dev server](/dev-server/).

To build the site into `public/`:

```sh
bun run build
```

<bongo:note>
The `bongo` command starts with Node, and image processing needs Bun. To resize images, run the scripts through Bun: `bun --bun run dev` and `bun --bun run build`. See [Images](/images/#bun-runtime).
</bongo:note>

## Starter files

The new folder holds a small blog:

```
my-site/
├── assets/
│   ├── main.ts
│   └── style.css
├── content/
│   ├── blog/
│   │   ├── index.hbs
│   │   └── welcome.md
│   ├── about.md
│   ├── contact.md
│   └── index.md
├── layouts/
│   ├── blog/
│   │   ├── index.hbs
│   │   └── single.hbs
│   └── html.hbs
├── partials/
│   ├── footer.hbs
│   ├── nav.hbs
│   └── postmeta.hbs
├── .editorconfig
├── .gitignore
├── bongo.config.ts
├── package.json
└── tsconfig.json
```

The blog in `content/blog/` has more posts than this tree shows. [Project layout](/project/) describes each folder.

The `package.json` has two scripts, and installs `bongo`, `@bongo/markdown`, and `shiki` as dev dependencies:

```json [package.json]
{
  "private": true,
  "scripts": {
    "dev": "bongo dev",
    "build": "bongo build"
  },
  "devDependencies": {
    "@bongo/markdown": "latest",
    "bongo": "npm:@bongo/bongo",
    "shiki": "^4.0.2"
  }
}
```

## create-bongo options

```sh
bun create bongo my-site --force
bun create bongo my-site -C ../sites
bun create bongo --help
```

| Option | Default | Description |
| --- | --- | --- |
| `-C`, `--cwd` | `.` | The folder that holds the new site folder. |
| `-f`, `--force` | off | Write into a site folder that already exists, and overwrite its files. |
| `-v`, `--version` | | Show the version. |
| `-h`, `--help` | | Show the help. |

Without `--force`, `create-bongo` refuses to write into a folder that exists, and stops with `Refusing to overwrite existing "my-site" directory.`

## Add bongo by hand

### Install

Install bongo through its `bongo` alias, and the Markdown plugin:

```sh
bun add bongo@npm:@bongo/bongo
bun add @bongo/markdown
```

### Add a config

Create `bongo.config.ts` in the project folder:

```ts [bongo.config.ts]
import { markdown } from '@bongo/markdown';

export default {
	$site: {
		title: 'My Site',
		url: 'https://example.com/',
		lang: 'en',
	},
	plugins: [
		markdown(),
	],
};
```

See [Config](/config/) for all fields.

### Add a layout

Every page needs a `layouts/html.hbs`. It prints the page inside an HTML document:

```hbs [layouts/html.hbs]
<!doctype html>
<html lang="{{ $site.lang }}">
<head>
  <meta charset="utf-8"/>
  <title>{{ $page.title }}</title>
</head>
<body>
  {{{ $page.content }}}
</body>
</html>
```

See [Templates](/templates/) for layouts and template values.

### Add a page

Create `content/index.md`:

```md [content/index.md]
---
title: Home
---

# Hello
```

See [Content](/content/) for page files and URLs.

### Run it

Start the dev server:

```sh
bunx bongo dev
```

Build the site into `public/`:

```sh
bunx bongo build
```

To run them as `bun run dev` and `bun run build`, add the two scripts from the [starter files](#starter-files) to your `package.json`.

## Next steps

- [Project layout](/project/): learn what each folder does.
- [CLI](/cli/): see every command and option.
- [Templates](/templates/): add styles, scripts, and assets to your layout.
