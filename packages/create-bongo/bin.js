#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
		'f': false,
	},
	alias: {
		'C': 'cwd',
		'f': 'force',
		'v': 'version',
		'h': 'help',
	}
});

function exit(msg, code = 1) {
	if (code) process.stderr.write(msg + '\n');
	else process.stdout.write(msg + '\n');
	process.exit(code);
}

if (argv.v) {
	let pkg = require('./package.json');
	exit(`${pkg.name}, v${pkg.version}`, 0);
}

if (argv.h) {
	let output = '';

	output += '\n  Usage';
	output += '\n    npm init bongo <name> [options]';
	output += '\n';
	output += '\n  Options';
	output += '\n    -C, --cwd        Directory to resolve from';
	output += '\n    -f, --force      Force directory overwrite';
	output += '\n    -v, --version    Displays current version';
	output += '\n    -h, --help       Displays this message';
	output += '\n';
	output += '\n  Examples';
	output += '\n    $ npm init bongo my-project';
	output += '\n    $ yarn create bongo website --force';
	output += '\n';

	exit(output, 0);
}

// TODO: logging
// TODO: format own errors
(async function () {
	try {
		let dir = argv._.join('-').trim().replace(/[\s_]+/g, '-');
		if (!dir) throw new Error('Missing <name> argument');
		await require('.').setup(dir, argv);
		console.log('DONE');
	} catch (err) {
		exit(err.stack, 1);
	}
})();
