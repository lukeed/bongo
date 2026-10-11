import type { BundledLanguage } from 'shiki';
import type { CodeBlockHighlighter } from 'md4x';

export type ShikiOptions = {
	theme: string;
	langs?: BundledLanguage[];
	/**
	 * What to do with a fence whose language is not loaded.
	 * @default 'plain' — escaped plain text, in the same theme
	 */
	unknown?: 'plain' | 'throw';
};

/**
 * A shiki highlighter for md4x code blocks.
 * Fences without a language keep md4x's default output.
 * @example markdown({ highlighter: shiki({ theme: 'github-dark', langs: ['ts', 'css'] }) })
 */
export async function shiki(options: ShikiOptions): Promise<CodeBlockHighlighter> {
	let { createHighlighter } = await import('shiki');
	let hl = await createHighlighter({
		themes: [ options.theme ],
		langs: options.langs || [],
	});
	let known = new Set<string>(hl.getLoadedLanguages());

	return function (code, block) {
		if (!block.lang) return;
		let lang = block.lang;
		if (!known.has(lang)) {
			if (options.unknown === 'throw') throw new Error(`[shiki] Language "${lang}" is not loaded; add it to \`langs\``);
			lang = 'text';
		}
		return hl.codeToHtml(code, { lang, theme: options.theme });
	};
}

export async function sugarhigh(): Promise<CodeBlockHighlighter> {
	let [{ highlight }, { lang }] = await Promise.all([
		import('sugar-high'),
		import('sugar-high/lang'),
	]);

	return function (code, block) {
		let name = lang(block.lang);
		if (name) return `<pre><code class="language-${name}">${highlight(code.replace(/\n$/, ''), { lang: name })}</code></pre>`;
	};
}
