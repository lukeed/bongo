const fs = require('fs');
const path = require('path');

const isDEV = process.argv.includes('--dev');

/**
 * @typedef {import('rolldown').Plugin} Plugin
 */

/**
 * Locate/auto-resolve files
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
 * Do NOT convert import() -> require()
 * @type {Plugin}
 */
const imports = {
	name: 'imports',
	renderDynamicImport(opts) {
		return {
			left: 'import(',
			right: ')',
		};
	}
}

const list = [resolve, imports];

module.exports = list;
