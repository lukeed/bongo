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
	let [{ highlight }, { lang }] = await Promise.all([
		import('sugar-high'),
		import('sugar-high/lang'),
	]);

	return function (code, block) {
		let name = lang(block.lang);
		if (name) return `<pre><code class="language-${name}">${highlight(code.replace(/\n$/, ''), { lang: name })}</code></pre>`;
	};
}
