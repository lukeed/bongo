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
	output += '\n    bun create bongo <name> [options]';
	output += '\n';
	output += '\n  Options';
	output += '\n    -C, --cwd        Directory to resolve from';
	output += '\n    -f, --force      Force directory overwrite';
	output += '\n    -v, --version    Displays current version';
	output += '\n    -h, --help       Displays this message';
	output += '\n';
	output += '\n  Examples';
	output += '\n    $ bun create bongo my-site';
	output += '\n    $ bun create bongo website --force';
	output += '\n';

	exit(output, 0);
}

(async function () {
	try {
		let dir = argv._.join('-').trim().replace(/[\s_]+/g, '-');
		if (!dir) throw new Error('Missing <name> argument');

		let rel = dir;
		if (argv.C !== '.') rel = require('path').join(argv.C, dir);

		await require('.').setup(dir, argv);

		let msg = '\n';
		msg += '  \x1b[32m\x1b[1m✓\x1b[22m Created \x1b[1m' + rel + '\x1b[22m\x1b[39m\n';
		msg += '\n';
		msg += '  Next steps:\n';
		msg += '  \x1b[36m$\x1b[39m cd ' + rel + '\n';
		msg += '  \x1b[36m$\x1b[39m bun install\n';
		msg += '  \x1b[36m$\x1b[39m bun run dev\n';
		msg += '\n';
		process.stdout.write(msg);
	} catch (err) {
		let msg = '\n  \x1b[31m\x1b[1m✗\x1b[22m ' + (err.message || err) + '\x1b[39m\n\n';
		process.stderr.write(msg);
		process.exit(1);
	}
})();
