import type { Loader } from 'bongo';
import type { Options } from 'markdown-it';

type Loaders = {
	md: Loader
};

export function markdown(options?: Options): {
	$assets: Loaders;
}
