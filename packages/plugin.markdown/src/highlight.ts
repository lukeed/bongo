import type { CodeBlockHighlighter, CodeBlock } from 'md4x';

export type Highlighter = CodeBlockHighlighter & {
	load(): Promise<void>;
};

// -- shiki --------------------------------------------------------------------

export type ShikiOptions = {
	theme: string;
	langs?: string[];
};

type ShikiInstance = {
	codeToHtml(code: string, options: { lang: string; theme: string }): string;
};

export function shiki(options: ShikiOptions): Highlighter {
	let hl: ShikiInstance | undefined;

	// Variable defeats TS static module resolution — shiki is an optional peer dep.
	let _m = 'shiki';
	let pending = import(_m).then(async (m: {
		createHighlighter(opts: { themes: string[]; langs: string[] }): Promise<ShikiInstance>;
	}) => {
		hl = await m.createHighlighter({
			themes: [options.theme],
			langs: options.langs || [],
		});
	});

	function highlighter(code: string, block: CodeBlock): string | undefined {
		if (!block.lang || !hl) return;
		return hl.codeToHtml(code, { lang: block.lang, theme: options.theme });
	}

	highlighter.load = () => pending;
	return highlighter;
}

// -- sugar-high ---------------------------------------------------------------

export function sugarhigh(): Highlighter {
	let fn: ((code: string) => string) | undefined;

	let _m = 'sugar-high';
	let pending = import(_m).then((m: {
		highlight(code: string): string;
	}) => {
		fn = m.highlight;
	});

	function highlighter(code: string): string | undefined {
		if (!fn) return;
		return fn(code);
	}

	highlighter.load = () => pending;
	return highlighter;
}
