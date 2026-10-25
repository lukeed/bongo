import type { Args, Blocks } from 'tempura';

type Promisable<T> = Promise<T> | T;

export interface Argv {
	cwd: string;
	dev?: boolean;
	minify?: boolean;
	/** `bongo dev` only: also write the output to the output folder. @default false */
	write?: boolean;
	/** The folder to write the site to, from `cwd`. It wins over `$build.outdir`. @default 'public' */
	outdir?: string;
	/** Render every page, and ignore what the last build kept. @default false */
	fresh?: boolean;
	/** Build each draft: a page with `draft: true`, or a `date` after the build starts, unless it has `draft: false`. @default false, and true for `bongo dev` */
	drafts?: boolean;
	// added via normalize
	src?: string;
	dest?: string;
	assets?: string;
	content?: string;
	data?: string;
	partials?: string;
	layouts?: string;
	debug?: boolean;
	port?: number;
	host?: string;
}

export type Loader = (
	file: string,
	content: Uint8Array | string,
	utils: Loader.Utilities,
) => Promisable<Loader.Result>;

export namespace Loader {
	type Metadata = Record<string, unknown>;

	// Raw source map (v3). Loaders may also return the map as a JSON string —
	// consumers (rolldown, lightningcss) accept either.
	interface SourceMapObject {
		version: number;
		sources: (string | null)[];
		mappings: string;
		names?: string[];
		file?: string;
		sourceRoot?: string;
		sourcesContent?: (string | null)[];
	}

	type SourceMap = string | SourceMapObject;

	/** A heading of the HTML that a loader writes. Without `html`, bongo uses the escaped `text`. */
	type Heading = Omit<Template.Heading, 'html'> & { html?: string };

	interface Result {
		filename: string;
		content: Uint8Array | string;
		metadata?: Loader.Metadata;
		sourcemap?: Loader.SourceMap | null;
		/** The headings of `content`, in document order. They become `$page.headings`. */
		headings?: Loader.Heading[];
	}

	interface Utilities {
		decode(input: Uint8Array): string;
		render(partial: string, ...args: any[]): Promisable<string>;
		frontmatter(content: string): {
			offset: number;
			value: Metadata;
		};
		/**
		 * Parse element attributes as data; values are never evaluated.
		 * @example utils.attrs('name="Luke" count=2 tags=[a, b] featured') //=> { name: 'Luke', count: 2, tags: ['a', 'b'], featured: true }
		 */
		attrs(input: string): Record<string, unknown>;
	}
}

export type { Args, Blocks };

export namespace Template {
	// TODO: import from tempura
	type Compiler<T extends Args = Args> = (data: T, blocks?: Blocks) => Promise<string> | string;
	type Partials = Blocks;

	interface Menu {
		name: string;
		href: string;
	}

	interface Site {
		url: string;
		lang: string;
		title: string;
		description?: string;
		menu?: {
			[name: string]: Menu;
		};
	}

	/**
	 * A heading of a page, as its loader reports it. `.html` and `.hbs` content has none.
	 * @example { level: 2, id: 'install', text: 'Install bongo', html: 'Install <code>bongo</code>' }
	 */
	type Heading = {
		level: number;
		/** The anchor that the heading has in the page HTML. */
		id: string;
		/** Plain text, entities resolved. Escape it for HTML. */
		text: string;
		/** The inner HTML, such as inline code. */
		html: string;
	};

	// TODO: lastmodified value
	// TODO: file.abs path
	// TODO: file.rel path
	interface Page {
		url: string;
		path: string;
		title: string;
		summary: string;
		section: string;
		tags: string[];
		headings: Heading[];
		params: Params;
		/** Whether the page is a draft: it has `draft: true`, or a `date` after the build started, unless it has `draft: false`. Only a build with drafts has one. */
		draft: boolean;
		content: string;
		scripts: string;
		styles: string;
	}

	type PageInfo = {
		path: string;    // URL path (e.g. '/blog/post-1/')
		url: string;     // absolute URL (e.g. 'https://example.com/blog/post-1/')
		title: string;
		summary: string;
		section: string; // directory prefix (e.g. 'blog', '' for root)
		tags: string[];  // parsed from frontmatter
		headings: Heading[]; // from the page's loader; empty for .html and .hbs content
		params: Params;  // full frontmatter
		/** Whether the page is a draft: it has `draft: true`, or a `date` after the build started, unless it has `draft: false`. Only a build with drafts has one. */
		draft: boolean;
		/** The `<bongo:alternate>` elements of the page, as `{ type: href }`, such as `{ 'text/markdown': '/config.md' }`. Only output files and data modules see it, since a page's elements are found after its layouts render. */
		alternates?: Record<string, string>;
	};

	type TagEntry = {
		tag: string;
		pages: PageInfo[];
	};

	/** `$assets` in layouts, partials, and `.hbs` content. */
	type Assets = {
		/**
		 * Read a file of `assets/`; with an encoding, as text.
		 * @example {{{ await $assets.load('img/logo.svg', 'utf8') }}}
		 */
		load(filename: string, encoding?: BufferEncoding): Promise<string | Buffer>;
		/**
		 * Draw a partial as an image, with the values of the current page, and return the URL path of the image.
		 * The extension of `output` picks the format: `.svg` and `.png` work everywhere, `.jpg` and `.webp` need Bun.
		 * Without `output`, the image is a PNG named from its partial and content. Needs `satori`, and `@resvg/resvg-js` for all but SVG.
		 * @example {{#var card = await $assets.render('og/card', 'og/' + $utils.slug($page.title) + '.png')}}
		 */
		render(template: string, output?: string, options?: Render): Promise<string>;
	};

	type Render = {
		/** @default 1200 */
		width?: number;
		/** @default 630 */
		height?: number;
		/** Values for the partial, as the attributes of `{{#partial}}` are. */
		args?: Record<string, unknown>;
	};

	interface Params {
		[name: string]: unknown;
	}
}

interface Helpers {
  [name: string]: Function | Promise<any> | Helpers;
}

export namespace Build {
	/** A content file that a build writes: a page, or an output file such as `sitemap.xml.hbs`. */
	type File = {
		/** The URL path, like `/blog/post/` for a page or `/blog/index.xml` for an output file. */
		path: string;
		/** The frontmatter. */
		params: Template.Params;
	};

	type Context = File & {
		kind: 'page' | 'output';
		/** Every output file of the build, sorted by path. */
		outputs: File[];
		/** The config, with its plugins merged. */
		config: Required<Config>;
	};

	/**
	 * Change a rendered page or output file before it is written. Pages arrive with their final asset URLs.
	 * @example const year: Build.Transform = (text, ctx) => ctx.kind === 'page' ? text.replace('{year}', '2026') : text;
	 */
	type Transform = (text: string, ctx: Context) => Promisable<string>;

	type Hooks = {
		/** Plugins run first, in order, then the config's own; each gets the text the last one returned. */
		transform?: Transform;
	};

	/**
	 * What the default export of a data module, such as `content/search.json.ts`, receives when it is a function.
	 * @example export default ({ $pages }: Build.Data) => $pages.map(page => ({ title: page.title, path: page.path }));
	 */
	type Data = {
		$site: Template.Site;
		$pages: Template.PageInfo[];
		/** The pages in the module's own folder. */
		$section: Template.PageInfo[];
		$tags: Template.TagEntry[];
		$data: Record<string, unknown>;
		$utils: NonNullable<Config['$utils']>;
	};
}

export namespace Images {
	type Format = 'avif' | 'webp' | 'jpeg' | 'png';

	type Options = {
		/** Output widths in pixels. A source is never enlarged: wider ones become its own width. @default [640, 960, 1280, 1920, 2880] */
		widths?: number[];
		/** Output formats, best first; `original` is the format of each source. Content images use only the first; the last is the `<img>` fallback of `<bongo:image>`. `avif` needs an Apple Silicon M3+ Mac or Windows. @default ['webp', 'original'] */
		formats?: (Format | 'original')[];
		/** Encoder quality from 1 to 100, for all lossy formats or per format. PNG is always lossless. @default { avif: 50, webp: 80, jpeg: 80 } */
		quality?: number | Partial<Record<Format, number>>;
		/** The `sizes` of images that do not set one. A leading `auto` applies only to lazy images. @default 'auto, 100vw' */
		sizes?: string;
		/** Process `<img>` elements in content that have a relative `src`. @default true */
		content?: boolean;
		/** Delete cached images and renders that no build has used for this many days, checked at most once a day; `false` keeps them all. @default 30 */
		prune?: number | false;
	};
}

export interface Config {
	$site: Template.Site;
	// bongo provides these built-ins; a config may override or extend them
	$utils?: Helpers & {
		truncate?(text: string, length: number): string;
		countwords?(text: string): number;
		slug?(text: string): string;
		excerpt?(html: string, length: number): string;
		minutes?(text: string, wpm?: number): number;
		json?(value: unknown): string;
		url?: Helpers & {
			abs?(to: string, fro?: string): string;
			path?(to: string, fro?: string): string;
			/**
			 * The path of a page plus an extension, as `<bongo:alternate>` names its file.
			 * @example $utils.url.ext('/config/', 'md') //=> '/config.md'
			 */
			ext?(path: string, ext: string): string;
		};
		date?: Helpers & {
			format?(value: string|number|Date, options?: Intl.DateTimeFormatOptions): string;
		};
	};
	$loaders?: {
		[extension: string]: Loader;
	};
	$partials?: Template.Partials;
	$build?: {
		/**
		 * The browsers to build for, as a browserslist query or a list of queries. It sets the CSS prefixes and the syntax that CSS and JavaScript are lowered to.
		 * @default 'defaults'
		 * @example $build: { target: ['chrome >= 120', 'safari >= 17', 'firefox >= 121'] }
		 */
		target?: string | string[];
		/**
		 * Names to replace in scripts, each with the code of its value. It replaces the built-in `process.env.NODE_ENV`, `import.meta.env.DEV`, and `import.meta.env.PROD` too.
		 * @example $build: { define: { __VERSION__: JSON.stringify('1.2.3') } }
		 */
		define?: Record<string, string>;
		/**
		 * The folder to write the site to, from the project folder. bongo owns this folder: it deletes each file in it that the build does not write, and a failed build empties it. The `--outdir` flag wins over it.
		 * @default 'public'
		 * @example $build: { outdir: 'web/public' }
		 */
		outdir?: string;
	};
	$images?: Images.Options;
	$hooks?: Build.Hooks;
	plugins?: Partial<Config>[];
}

/**
 * Run one build, as `bongo build` does. Resolves when the site is written.
 * @example await build({ cwd: 'site', minify: true });
 */
export function build(argv: Argv): Promise<void>;

/**
 * Start the dev server, as `bongo dev` does. Resolves after the first build; the server keeps running.
 * @example await dev({ cwd: 'site', port: 3000 });
 */
export function dev(argv: Argv): Promise<void>;

/**
 * Return the config as it is, typed as `Config`, for a JavaScript config file.
 * @example export default define({ $site: { title: 'My Site', url: 'https://example.com/', lang: 'en' } });
 */
export function define(config: Config): Config;
