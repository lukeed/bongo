// Ambient JSX augmentation for bongo's template namespace.
//
// Loaded automatically when a project extends `@lukeed/bongo/tsconfig`
// (which pins `compilerOptions.types: ["@lukeed/bongo/jsx"]`). Can also
// be pulled in explicitly:
//
//   /// <reference types="@lukeed/bongo/jsx" />

type BongoTransitions = boolean | 'fade' | 'initial' | 'slide' | (string & {});
type BongoPrefetchMode = boolean | 'hover' | 'tap';

type BongoClientAttrs = {
	transitions?: BongoTransitions;
	prefetch?: BongoPrefetchMode;
};

type BongoScriptAttrs = {
	src: string;
	inline?: boolean;
	async?: boolean;
	defer?: boolean;
	format?: 'esm' | 'cjs';
	target?: string;
};

type BongoStyleAttrs = {
	src: string;
	inline?: boolean;
	global?: boolean;
};

type BongoAssetAttrs = {
	src: string;
	preload?: boolean;
	as?: string;
	type?: string | false;
	crossorigin?: boolean | 'anonymous' | 'use-credentials' | false;
	media?: string;
	fetchpriority?: 'high' | 'low' | 'auto';
};

type BongoImageAttrs = {
	src: string;
	alt?: string;
	sizes?: string;
	widths?: string;
	formats?: string;
	quality?: number | string;
	width?: number | string;
	height?: number | string;
	loading?: 'lazy' | 'eager';
	decoding?: 'async' | 'sync' | 'auto';
	fetchpriority?: 'high' | 'low' | 'auto';
};

declare global {
	namespace JSX {
		// Build-time view-transition attributes — valid on any element.
		interface HTMLAttributes<T> {
			'transition:name'?: string;
			'transition:animate'?: string;
		}

		// Anchor-only opt-outs consumed by the client runtime.
		interface AnchorHTMLAttributes<T> {
			'transition:disable'?: boolean;
			'prefetch:disable'?: boolean;
		}

		// bongo-provided custom elements. Accept the standard HTML attribute
		// surface plus their own flags.
		interface IntrinsicElements {
			'bongo:asset': HTMLAttributes<HTMLElement> & BongoAssetAttrs;
			'bongo:client': HTMLAttributes<HTMLElement> & BongoClientAttrs;
			'bongo:image': HTMLAttributes<HTMLElement> & BongoImageAttrs;
			'bongo:script': HTMLAttributes<HTMLElement> & BongoScriptAttrs;
			'bongo:style': HTMLAttributes<HTMLElement> & BongoStyleAttrs;
		}
	}
}

export {};
