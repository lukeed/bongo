import type { Loader } from 'bongo';
import type { HtmlOptions } from 'md4x';

type Loaders = {
	md: Loader
};

export function markdown(options?: HtmlOptions): {
	$assets: Loaders;
}
