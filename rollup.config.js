const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { transform } = require('esbuild');
// const { transpileModule } = require('typescript');
const tsconfig = require('./tsconfig.json');
const pkg = require('./package.json');

const isDEV = !!process.env.ROLLUP_WATCH;

const resolve = {
	name: 'resolve',
	resolveId(file, importer) {
		let tmp, { ext } = path.parse(file);
		if (ext) return file;

		let next = path.resolve(path.dirname(importer), file);
		if (fs.existsSync(next)) return next;

		if (fs.existsSync(tmp = next + '.ts')) return tmp;
		if (fs.existsSync(tmp = next + '.js')) return tmp;

		return null;
	}
};

const terser = {
	name: 'terser',
	renderChunk(code, _chunk, opts) {
		return minify(code, {
			toplevel: true,
			sourceMap: !!opts.sourcemap,
			compress: true,
		});
	}
};

const esbuild = {
	name: 'esbuild',
	async transform(code, file) {
		if (!/\.ts$/.test(file)) return code;

		let output = await transform(code, {
			// @ts-ignore
			tsconfigRaw: tsconfig,
			sourcemap: false,
			sourcefile: file,
			format: 'esm',
			loader: 'ts',
			minify: !isDEV,
		});

		return {
			code: output.code,
			map: output.map || null
		};
	}
};

module.exports = {
	input: 'src/index.ts',
	output: {
		format: 'cjs',
		file: 'index.js',
		preferConst: true,
		esModule: false,
		interop: false,
		strict: false,
		freeze: false
	},
	external: [
		...require('module').builtinModules,
		...Object.keys(pkg.dependencies),
	],
	plugins: [
		resolve,
		esbuild,
		!isDEV && terser,
	]
}
