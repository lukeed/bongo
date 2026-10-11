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

/**
 * Highlight code blocks with twinkleplop, using the language highlighters you pass in.
 * Common aliases of a registered language resolve to it, so `typescript` also covers `ts`, `mts` and `cts` fences.
 * @example
 * import { language as typescript } from '@twinkleplop/typescript';
 * markdown({ highlighter: twinkleplop({ languages: { typescript: typescript() } }) });
 */
export function twinkleplop(options: Options): Promise<CodeBlockHighlighter>;
