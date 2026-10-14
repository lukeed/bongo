#!/usr/bin/env node
const { parseArgs } = require('node:util');

let args = process.argv.slice(2);
// A bare `--host` exposes the server on every interface, as sirv-cli's does.
args = args.map((arg, i) => (arg === '--host' || arg === '-H') && !/^[^-]/.test(args[i + 1] || '') ? '--host=0.0.0.0' : arg);

try {
	var { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			cwd: { type: 'string', short: 'C', default: '.' },
			host: { type: 'string', short: 'H' },
			port: { type: 'string', short: 'p' },
			minify: { type: 'boolean', short: 'm', default: false },
			debug: { type: 'boolean', short: 'd', default: false },
			write: { type: 'boolean', short: 'w', default: false },
			version: { type: 'boolean', short: 'v' },
			help: { type: 'boolean', short: 'h' },
		},
	});
	var port = values.port === undefined ? undefined : Number(values.port);
	if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
		throw new Error(`Invalid --port "${values.port}"; use a port number`);
	}
} catch (err) {
	console.error('ERROR', err.message);
	process.exit(1);
}

if (values.version) {
	const pkg = require('./package.json');
	console.log(`${pkg.name}, v${pkg.version}`);
	process.exit(0);
}

if (values.help) {
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
		let name = (positionals[0] || '').trim().toLowerCase();
		if (!name) throw new Error('Missing <command> argument');

		let command = require('.')[name];
		if (!command) throw new Error(`Unknown "${name}" command`);

		let { cwd, host, minify, debug, write } = values;
		await command({ cwd, host, port, minify, debug, write });
	} catch (err) {
		console.error('ERROR', err.stack);
		process.exit(1);
	}
})();
