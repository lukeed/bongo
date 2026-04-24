import type { BundledLanguage } from 'shiki';
import type { CodeBlockHighlighter } from 'md4x';

export type ShikiOptions = {
	theme: string;
	langs?: BundledLanguage[];
};

export async function shiki(options: ShikiOptions): Promise<CodeBlockHighlighter> {
	let { createHighlighter } = await import('shiki');
	let hl = await createHighlighter({
		themes: [ options.theme ],
		langs: options.langs || [],
	});

	return function (code, block) {
		if (block.lang) return hl.codeToHtml(code, {
			lang: block.lang,
			theme: options.theme
		});
	};
}

export async function sugarhigh(): Promise<CodeBlockHighlighter> {
	let { highlight } = await import('sugar-high');
	return function (code) {
		return highlight(code);
	};
}
