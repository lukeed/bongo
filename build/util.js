const { join } = require('path');
const { gzipSync } = require('zlib');
const { builtinModules } = require('module');
const { readdir } = require('fs/promises');
const { rollup } = require('rollup');

const plugins = require('./plugins');
const packages = join(__dirname, '../packages');

/**
 * @type {import('rollup').OutputOptions}
 */
const output = {
	format: 'cjs',
	file: '~inject~',
	preferConst: true,
	esModule: false,
	interop: false,
	strict: false,
	freeze: false
};

const UNITS = ['B ', 'kB', 'MB', 'GB'];

function size(val=0) {
	if (val < 1e3) return `${val} ${UNITS[0]}`;
	let exp = Math.min(Math.floor(Math.log10(val) / 3), UNITS.length - 1) || 1;
	let out = (val / Math.pow(1e3, exp)).toPrecision(3);
	let idx = out.indexOf('.');
	if (idx === -1) out += '.00';
	else if (out.length - idx - 1 !== 2) {
		out = (out + '00').substring(0, idx + 3); // 2 + 1 for 0-based
	}
	return out + ' ' + UNITS[exp];
}

exports.list = () => readdir(packages);

/**
 * @param {string} dir
 */
exports.build = async function (dir) {
	try {
		let abs = join(packages, dir);
		let pkg = require(join(abs, 'package.json'));

		let external = [
			...builtinModules,
			...Object.keys(pkg.dependencies || {}),
			...Object.keys(pkg.peerDependencies || {}),
			...Object.keys(pkg.optionalDependencies || {}),
		];

		let bundle = await rollup({
			input: join(abs, 'src/index.ts'),
			plugins, external,
		});

		let result = await bundle.write({
			...output, file: join(abs, 'index.js')
		});

		let { code } = result.output[0];
		let outfile = join(dir, 'index.js');

		let txt = outfile + ' :: ' + size(code.length);
		txt += '  (' + size(gzipSync(code).length) + ')';

		console.log('~>', txt);
	} catch (err) {
		let msg = (err.message || err || 'Unknown error').replace(/(\r?\n)/g, '$1      ');
		console.error('[ERROR]', msg);
		process.exit(1);
	}
}
