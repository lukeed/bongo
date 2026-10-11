import type { MarkdownOptions } from '@twinkleplop/markdown-core';
import type { CodeBlockHighlighter } from 'md4x';

export type Options = Omit<MarkdownOptions, 'inline' | 'on_unknown_language'> & {
	/**
	 * How to render a fence whose language is not in `languages`.
	 * `"plain"` renders the code as escaped text and `"throw"` fails the build.
	 * @default "plain"
	 */
	on_unknown_language?: MarkdownOptions['on_unknown_language'];
};

const ALIASES = [
	['bash', 'sh', 'shell', 'zsh'],
	['c', 'h'],
	['cpp', 'c++', 'cc'],
	['dockerfile', 'docker'],
	['graphql', 'gql'],
	['javascript', 'js', 'mjs', 'cjs'],
	['markdown', 'md'],
	['powershell', 'ps', 'ps1'],
	['python', 'py'],
	['rust', 'rs'],
	['shellsession', 'console'],
	['typescript', 'ts', 'mts', 'cts'],
	['yaml', 'yml'],
];

/**
 * Highlight code blocks with twinkleplop, using the language highlighters you pass in.
 * Common aliases of a registered language resolve to it, so `typescript` also covers `ts`, `mts` and `cts` fences.
 * @example
 * import { language as typescript } from '@twinkleplop/typescript';
 * markdown({ highlighter: twinkleplop({ languages: { typescript: typescript() } }) });
 */
export async function twinkleplop(options: Options): Promise<CodeBlockHighlighter> {
	let { create_renderer } = await import('@twinkleplop/markdown-core');

	let aliases = ALIASES.flatMap(names => {
		let target = names.find(name => Object.hasOwn(options.languages, name));
		return target ? names.map(name => [name, target] as const) : [];
	});

	let renderer = create_renderer({
		...options,
		languages: { ...Object.fromEntries(aliases), ...options.languages },
		on_unknown_language: options.on_unknown_language ?? 'plain',
	});

	return function (code, block) {
		let colon = block.lang.indexOf(':');
		let lang = colon === -1 ? block.lang : block.lang.slice(0, colon);
		let meta = [
			colon === -1 ? '' : block.lang.slice(colon),
			block.highlights?.length ? `{${block.highlights.join(',')}}` : '',
			block.filename ? `[${block.filename}]` : '',
		].filter(Boolean).join(' ');

		return renderer.fence(lang, meta, code) ?? undefined;
	};
}
