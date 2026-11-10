/// <reference lib="dom" />

export type Preset = 'fade' | 'initial' | 'slide';

export type Options = boolean | Preset | (string & {}) | undefined;

const CSS: Record<string, string> = {
	fade: [
		'@keyframes bongo-fade-in{from{opacity:0}to{opacity:1}}',
		'@keyframes bongo-fade-out{from{opacity:1}to{opacity:0}}',
		'::view-transition-old(root){animation-name:bongo-fade-out;animation-duration:.18s}',
		'::view-transition-new(root){animation-name:bongo-fade-in;animation-duration:.18s}',
	].join(''),
	slide: [
		'@keyframes bongo-slide-in{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}',
		'@keyframes bongo-slide-out{from{transform:none;opacity:1}to{transform:translateX(-16px);opacity:0}}',
		'::view-transition-old(root){animation-name:bongo-slide-out;animation-duration:.22s}',
		'::view-transition-new(root){animation-name:bongo-slide-in;animation-duration:.22s}',
	].join(''),
};

/** @internal — used by tests only */
export function resolve(opt: Options): Preset | (string & {}) | undefined {
	if (opt === true) return 'fade';
	else if (opt) return opt;
}

/**
 * The preset goes in the `bongo` cascade layer. The tag is appended to
 * `<head>`, so it is always after the stylesheets of the page, and source
 * order would else make a preset that you opt into one you cannot override.
 * An unlayered rule beats a layered one whatever the order, so your own CSS
 * wins without `!important`.
 */
export function inject(name: Preset | (string & {})): void {
	let css = CSS[name];
	if (!css) return; // 'initial' or unknown custom preset — user handles CSS
	if (document.querySelector(`style[data-bongo-preset="${name}"]`)) return;
	let el = document.createElement('style');
	el.setAttribute('data-bongo-preset', name);
	el.textContent = `@layer bongo{${css}}`;
	document.head.appendChild(el);
}
