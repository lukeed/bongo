import * as lightningcss from 'lightningcss';
import browserslist from 'browserslist';

// Run a browserslist query (string or array of strings) through
// lightningcss's `browserslistToTargets` to get a normalised Targets object.
export function parse(query: string | string[]): lightningcss.Targets {
	return lightningcss.browserslistToTargets(browserslist(query));
}

// Convert a lightningcss Targets object into the esbuild-style string[] that
// rolldown's oxc transform accepts (e.g. ['chrome120', 'ios17']). Drops
// engines rolldown doesn't know (`android`, `samsung`); folds `ios_saf`
// onto rolldown's `ios`. LightningCSS packs versions as
// `(major << 16) | (minor << 8) | patch` — shift to recover the major.
// https://rolldown.rs reference: chrome, deno, edge, firefox, hermes, ie,
// ios, node, opera, rhino, safari.
const TARGET_MAP: Record<keyof lightningcss.Targets, string | null> = {
	chrome: 'chrome',
	edge: 'edge',
	firefox: 'firefox',
	ie: 'ie',
	opera: 'opera',
	safari: 'safari',
	ios_saf: 'ios',
	android: null,
	samsung: null,
};

export function translate(input: lightningcss.Targets): string[] {
	let out: string[] = [];
	for (let [key, packed] of Object.entries(input)) {
		let name = TARGET_MAP[key as keyof lightningcss.Targets];
		if (!name || typeof packed !== 'number') continue;
		let major = packed >> 16;
		out.push(`${name}${major}`);
	}
	return out;
}
