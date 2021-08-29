#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
		'm': false,
		'd': false,
	},
	alias: {
		'C': 'cwd',
		'd': 'debug',
		'm': 'minify',
		'v': 'version',
		'h': 'help',
	}
});

if (argv.v) {
	const pkg = require('./package.json');
	console.log(`${pkg.name}, v${pkg.version}`);
	process.exit(0);
}

if (argv.h) {
	let output = '';
	output += '\n  Usage';
	output += '\n    ssg <command> [options]';
	output += '\n';
	output += '\n  Available Commands';
	output += '\n    build    Build the source directory';
	output += '\n';
	output += '\n  Options';
	output += '\n    -C, --cwd        Directory to resolve from  (default .)';
	output += '\n    -m, --minify     Compress built assets  (default false)';
	output += '\n    -v, --version    Displays current version';
	output += '\n    -h, --help       Displays this message';
	output += '\n';

	process.stdout.write(output + '\n');
	process.exit(0);
}

(async function () {
	try {
		let name = (argv._[0] || '').trim().toLowerCase();
		if (!name) throw new Error('Missing <command> argument');

		let command = require('.')[name];
		if (!command) throw new Error(`Unknown "${name}" command`);

		argv._ = argv._.slice(1);
		await command(argv);
	} catch (err) {
		console.error('ERROR', err.stack);
		process.exit(1);
	}
})();
