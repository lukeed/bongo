type Promisable<T> = Promise<T> | T;

// export interface Argv {
// 	cwd: string;
// 	dev?: boolean;
// 	minify?: boolean;
// 	// added via normalize
// 	src?: string;
// 	dest?: string;
// 	assets?: string;
// 	content?: string;
// 	partials?: string;
// 	layouts?: string;
// 	debug?: boolean;
// 	port?: number;
// 	host?: string;
// }

// TODO: Uint8Array instead of Buffer?
export type Loader = (
	file: string,
	content: Buffer | string,
	utils: Loader.Utilities,
) => Promisable<Loader.Result>;

export namespace Loader {
	export type Metadata = Record<string, unknown>;

	export interface Result {
		filename: string;
		content: Buffer | string;
		metadata?: Loader.Metadata;
		sourcemap?: any | null; // TODO
	}

	export interface Utilities {
		// decode(input: Uint8Array): string;
		render(partial: string, ...args: any[]): Promisable<string>;
		frontmatter(content: string): {
			offset: number;
			value: Metadata;
		};
	}
}

export namespace Template {
	export type Compiler = import('tempura').Compiler;
	export type Partials = import('tempura').Blocks;

	export interface Menu {
		name: string;
		href: string;
	}

	export interface Site {
		url: `${'http' | 'https'}://${string}/`;
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
	export interface Page {
		url: string;
		path: string;
		title: string;
		params: Params;
		summary: string;
		content: string;
		scripts: string;
		styles: string;
	}

	export interface Params {
		[name: string]: unknown;
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
	// plugins?: Partial<Config>[];
}
