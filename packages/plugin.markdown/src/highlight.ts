import type { createHighlighter } from 'shiki';
import type { CodeBlockHighlighter, CodeBlock } from 'md4x';

// -- shiki --------------------------------------------------------------------

export type ShikiOptions = {
	theme: string;
	langs?: Parameters<typeof createHighlighter>[0]['langs'];
};

export function shiki(options: ShikiOptions): Promise<CodeBlockHighlighter> {
	return import('shiki').then(async (m) => {
		let hl = await m.createHighlighter({
			themes: [options.theme],
			langs: options.langs || [],
		});

		return function highlighter(code: string, block: CodeBlock): string | undefined {
			if (!block.lang) return;
			return hl.codeToHtml(code, { lang: block.lang, theme: options.theme });
		};
	});
}

// -- sugar-high ---------------------------------------------------------------

export function sugarhigh(): Promise<CodeBlockHighlighter> {
	return import('sugar-high').then((m) => {
		return function highlighter(code: string): string | undefined {
			return m.highlight(code);
		};
	});
}
