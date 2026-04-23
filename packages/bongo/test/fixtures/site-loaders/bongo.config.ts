import type { Config, Loader } from 'bongo';

// Pseudo-SCSS loader — .scss => .css. Appends a marker rule with a filename-
// derived selector so tests can verify the loader actually ran on each file.
// (lightningcss strips comments, so we use a unique selector instead.)
let scss: Loader = (filename, content, utils) => {
	let src = typeof content === 'string' ? content : utils.decode(content);
	let base = (filename.match(/([^\\/]+)\.scss$/)?.[1] ?? 'unknown');
	return {
		filename: filename.replace(/\.scss$/, '.css'),
		content: `${src}\n.__loaded_${base}__ { color: red; }\n`,
	};
};

// Pseudo-JSX loader — strips a single `<tag/>` literal and emits JS. Enough
// to prove the rolldown loader hook fires on a non-native extension.
let jsx: Loader = (filename, content, utils) => {
	let src = typeof content === 'string' ? content : utils.decode(content);
	let out = src.replace(/<(\w+)\s*\/>/g, (_m, tag) => `"<${tag}/>"`);
	return {
		filename: filename.replace(/\.jsx$/, '.js'),
		content: out,
	};
};

export default {
	$site: {
		url: 'https://example.com',
		title: 'Loaders Fixture',
		lang: 'en',
	},
	$assets: {
		scss,
		jsx,
	},
} satisfies Config;
