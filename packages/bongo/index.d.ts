type Promisable<T> = Promise<T> | T;

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

	interface Result {
		filename: string;
		content: Uint8Array | string;
		metadata?: Loader.Metadata;
		sourcemap?: any | null; // TODO
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
		params: Params;  // full frontmatter
	};

	type TagEntry = {
		tag: string;
		pages: PageInfo[];
		// Convenience: page paths joined with ',' for use in templates where nested #each is not available.
		pathsCsv: string;
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
	plugins?: Partial<Config>[];
}

export function build(argv: Argv): Promise<void>;
export function define(config: Config): Config;
