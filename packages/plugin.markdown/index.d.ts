import type { Loader } from 'bongo';
import type { CodeBlockHighlighter, HtmlOptions } from 'md4x';

export type Options = Omit<HtmlOptions, 'highlighter'> & {
	highlighter?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
};

type Loaders = {
	md: Loader
};

export function markdown(options?: Options): {
	$loaders: Loaders;
}
