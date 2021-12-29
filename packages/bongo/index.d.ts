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

export type Loader = (file: string, content: Uint8Array | string) => Promisable<{
	filename: string;
	content: Uint8Array | string;
	metadata?: Loader.Metadata;
	sourcemap?: any | null; // TODO
}>;

export namespace Loader {
	type Metadata = Record<string, unknown>;
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
		params: Params;
		summary: string;
		content: string;
		scripts: string;
		styles: string;
	}

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
	plugins?: Partial<Config>[];
}

export function build(argv: Argv): Promise<void>;
export function define(config: Config): Config;
