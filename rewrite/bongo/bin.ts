import * as build from './build';
import * as argv from './argv';
import * as dev from './dev';

const Argv = argv.parse(
	process.argv.slice(2)
);

function exit(msg: Error|string, code = 0): never {
	if (typeof msg !== 'string') msg = msg.stack || msg.message;
	if (code) process.stderr.write(msg + '\n');
	else process.stdout.write(msg + '\n');
	process.exit(code);
}

if (Argv.version) exit('TODO: version');

if (Argv.help && Argv.cmd) {
	exit(`TODO: ${Argv.cmd} --help text`);
}

if (argv.BUILD) {
	await build.run();
} else if (argv.DEV) {
	await dev.run(Argv);
} else {
	if (Argv.cmd) {
		console.error('Invalid "%s" command', Argv.cmd);
	}

	if (!Argv.help) process.exitCode = 1;
	console.log('TODO: global --help text');
}
