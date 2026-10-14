#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
		'm': false,
		'd': false,
		'w': false,
	},
	alias: {
		'C': 'cwd',
		'd': 'debug',
		'w': 'write',
		'm': 'minify',
		'v': 'version',
		'h': 'help',
		'H': 'host',
		'p': 'port',
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
	output += '\n    bongo <command> [options]';
	output += '\n';
	output += '\n  Available Commands';
	output += '\n    build    Build the source directory';
	output += '\n    dev      Develop with a live-reload server';
	output += '\n';
	output += '\n  Options';
	output += '\n    -C, --cwd        Directory to resolve from  (default .)';
	output += '\n    -H, --host       Host to bind; bare flag exposes network  (default localhost)';
	output += '\n    -p, --port       Port to bind  (default 3000)';
	output += '\n    -m, --minify     Compress built assets  (default false)';
	output += '\n    -d, --debug      Log each build stage and its time  (default false)';
	output += '\n    -w, --write      Dev only: also write the output to public/  (default false)';
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
