type Promisable<T> = Promise<T> | T;

export interface Argv {
	cwd: string;
	minify?: boolean;
	// added via normalize
	src?: string;
	dest?: string;
	assets?: string;
	content?: string;
	partials?: string;
	layouts?: string;
	debug?: boolean;
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

export namespace Template {
	type Compiler<T extends Args = Args> = import('tempura').Compiler<T>;

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

	interface Page {
		url: string;
		path: string;
		content: string;
		params: Params;
		summary?: string;
		scripts?: string;
		styles?: string;
		title?: string;
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
	$partials?: {
		[name: string]: Template.Compiler;
	};
}
