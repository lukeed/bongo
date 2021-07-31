type Promisable<T> = Promise<T> | T;

export interface Argv {
	cwd: string;
}

export type Loader = (file: string, content: Uint8Array | string) => Promisable<{
	filename: string;
	content: Uint8Array | string;
	map?: any | null; // TODO
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
		input: string;
		output: string;
		content: string;
		title?: string;
		summary?: string;
		scripts?: string;
		styles?: string;
		params?: {
			[name: string]: unknown;
		};
	}

	interface Utils {
		absurl(target: string): string;
		relurl(target: string): string;
		truncate(input: string, length: number): string;
	}
}
