export type TransitionPreset = 'fade' | 'initial' | 'slide' | 'none';

export type TransitionOption = boolean | TransitionPreset | (string & {}) | undefined;

const PRESET_CSS: Record<string, string> = {
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
export function resolvePreset(opt: TransitionOption): TransitionPreset | (string & {}) {
	if (opt === true) return 'fade';
	if (!opt) return 'none';
	return opt;
}

export function injectPresetCSS(preset: TransitionPreset | (string & {})): void {
	let css = PRESET_CSS[preset];
	if (!css) return; // 'initial', 'none', or unknown custom preset — user handles CSS
	if (document.querySelector(`style[data-bongo-preset="${preset}"]`)) return;
	let el = document.createElement('style');
	el.setAttribute('data-bongo-preset', preset);
	el.textContent = css;
	document.head.appendChild(el);
}
