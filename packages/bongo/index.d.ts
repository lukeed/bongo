type Promisable<T> = Promise<T> | T;

export interface Argv {
	cwd: string;
	dev?: boolean;
	minify?: boolean;
	/** `bongo dev` only: also write the output to `public/`. @default false */
	write?: boolean;
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

type Args = Record<string, any>;

// TODO: import from tempura
type Blocks = Record<string, Block>;
type Block = Template.Compiler & {
	setup?<T extends Args>(data: T): Promise<void> | void;
}

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
	};

	type TagEntry = {
		tag: string;
		pages: PageInfo[];
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
		/** Delete cached images that no build has used for this many days, checked at most once a day; `false` keeps them all. @default 30 */
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
		url?: Helpers & {
			abs?(to: string, fro?: string): string;
			path?(to: string, fro?: string): string;
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
		target?: string | string[];  // browserslist query or array of queries
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
