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
	shortcodes?: string;
	layouts?: string;
}

export type Loader = (file: string, content: Uint8Array | string) => Promisable<{
	filename: string;
	content: Uint8Array | string;
	metadata?: Record<string, unknown>;
	sourcemap?: any | null; // TODO
}>;

export namespace Variables {
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
