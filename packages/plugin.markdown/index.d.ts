import type { Loader } from 'bongo';
import type { CodeBlockHighlighter, HtmlOptions } from 'md4x';

export type Options = HtmlOptions & {
	highlight?: CodeBlockHighlighter | Promise<CodeBlockHighlighter>;
};

type Loaders = {
	md: Loader
};

export function markdown(options?: Options): {
	$assets: Loaders;
}
