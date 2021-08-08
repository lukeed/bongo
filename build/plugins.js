const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { transform } = require('esbuild');
const tsconfig = require('../tsconfig.json');

const isDEV = process.argv.includes('--dev');

/**
 * @typedef {import('rollup').Plugin} Plugin
 */

/**
 * @type {Plugin}
 */
const resolve = {
	name: 'resolve',
	resolveId(file, importer) {
		let tmp, { ext } = path.parse(file);
		if (ext) return file;

		// @ts-ignore - TODO: does this matter
		let next = path.resolve(path.dirname(importer), file);
		if (fs.existsSync(next)) return next;

		if (fs.existsSync(tmp = next + '.ts')) return tmp;
		if (fs.existsSync(tmp = next + '.js')) return tmp;

		return null;
	}
};

/**
 * @type {Plugin}
 */
const terser = {
	name: 'terser',
	async renderChunk(source, _chunk, opts) {
		let { code, map } = await minify(source, {
			toplevel: true,
			sourceMap: !!opts.sourcemap,
			compress: true,
		});

		if (code) return { code, map };
		this.warn('Missing chunk output!');
		return null;
	}
};

/**
 * @type {Plugin}
 */
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

const list = [resolve, esbuild];
isDEV || list.push(terser);

module.exports = list;
