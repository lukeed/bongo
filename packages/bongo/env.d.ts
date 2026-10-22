// Ambient types for the values that bongo puts in scripts.
//
//   /// <reference types="bongo/env" />

interface ImportMetaEnv {
	/** `true` in `bongo dev`. */
	readonly DEV: boolean;
	/** `true` in `bongo build`. */
	readonly PROD: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
