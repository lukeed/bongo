type Promisable<T> = Promise<T> | T;
type OutputContent = string | Uint8Array;

export interface Argv {
	cwd: string;
	dev?: boolean;
	minify?: boolean;
	// added via normalize
	src?: string;
	dest?: string;
	assets?: string;
	content?: string;
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

	interface Result {
		filename: string;
		content: Uint8Array | string;
		metadata?: Loader.Metadata;
		sourcemap?: Loader.SourceMap | null;
	}

	interface Utilities {
		decode(input: Uint8Array): string;
		render(partial: string, ...args: any[]): Promisable<string>;
		frontmatter(content: string): {
			offset: number;
			value: Metadata;
		};
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
		feeds: Feed.Link[];
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
		feeds?: Feed.Link[];
		params: Params;  // full frontmatter
	};

	type TagEntry = {
		tag: string;
		pages: PageInfo[];
	};

	interface Params {
		[name: string]: unknown;
	}

	interface Utils {
		absurl(target: string): string;
		relurl(target: string): string;
		truncate(input: string, length: number): string;
	}
}

export namespace Build {
	export type Context = {
		config: Config;
		pages: Template.PageInfo[];
		sections: Map<string, Template.PageInfo[]>;
		tags: Template.TagEntry[];
	};

	export type OutputContext = Context & {
		write(path: string, content: OutputContent): Promisable<void>;
	};

	export type Hooks = {
		pages?: (context: Context) => Promisable<void>;
		output?: (context: OutputContext) => Promisable<void>;
	};
}

export namespace Feed {
	export type Format = 'rss' | 'atom' | 'jsonl';

	export type Link = {
		format: Format;
		path: string;
		title: string;
		type: string;
		url: string;
	};
}

interface Helpers {
  [name: string]: Function | Promise<any> | Helpers;
}

export interface Config {
	$site: Template.Site;
	$utils?: Helpers & {
		truncate(text: string, length: number): string;
		countwords(text: string): number;
		url: {
			abs(to: string, fro?: string): string;
		};
		date: {
			format(value: string|number|Date, format: string): string;
		};
	};
	$assets?: {
		[extension: string]: Loader;
	};
	$partials?: Template.Partials;
	$build?: {
		target?: string | string[];  // browserslist query or array of queries
	};
	$hooks?: Build.Hooks;
	plugins?: Partial<Config>[];
}

export function build(argv: Argv): Promise<void>;
export function define(config: Config): Config;
