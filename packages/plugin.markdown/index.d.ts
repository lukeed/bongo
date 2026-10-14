import type { Loader } from 'bongo';
import type { CodeBlock, CodeBlockHighlighter, HtmlOptions } from 'md4x';

/**
 * Wrap the HTML of each code block, such as in a figure with a title bar.
 * @example markdown({ fence: (html, block) => `<figure data-lang="${block.lang}">${html}</figure>` })
 */
export type Fence = (html: string, block: Fence.Block) => string;

export namespace Fence {
	/** The block that the highlighter gets, plus its code. */
	type Block = CodeBlock & {
		code: string;
	};
}

export type Options = Omit<HtmlOptions, 'highlighter'> & {
	highlighter?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
	fence?: Fence;
};

type Loaders = {
	md: Loader
};

export function markdown(options?: Options): {
	$loaders: Loaders;
}
