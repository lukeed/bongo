#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs } from 'node:util';

function exit(msg, code = 1) {
	if (code) process.stderr.write(msg + '\n');
	else process.stdout.write(msg + '\n');
	process.exit(code);
}

function fail(err) {
	exit('\n  \x1b[31m\x1b[1m✗\x1b[22m ' + (err.message || err) + '\x1b[39m\n');
}

try {
	var { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			cwd: { type: 'string', short: 'C', default: '.' },
			force: { type: 'boolean', short: 'f', default: false },
			version: { type: 'boolean', short: 'v' },
			help: { type: 'boolean', short: 'h' },
		},
	});
} catch (err) {
	fail(err);
}

if (values.version) {
	let { default: pkg } = await import('./package.json', { with: { type: 'json' } });
	exit(`${pkg.name}, v${pkg.version}`, 0);
}

if (values.help) {
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
		let dir = positionals.join('-').trim().replace(/[\s_]+/g, '-');
		if (!dir) throw new Error('Missing <name> argument');

		let rel = dir;
		if (values.cwd !== '.') rel = join(values.cwd, dir);

		await (await import('./index.js')).setup(dir, { cwd: values.cwd, force: values.force });

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
		fail(err);
	}
})();
