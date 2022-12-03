import * as build from './build';
import * as dev from './dev';

const argv = process.argv.slice(2);

const expose = argv.includes('--public') || argv.includes('--expose');
const minify = argv.includes('-m') || argv.includes('--minify');

const isDEV = argv.includes('dev');
const isBUILD = argv.includes('build');

if (isBUILD) {
	await build.run({ minify });
}
else if (isDEV) {
	await dev.run({ minify, expose });
}
