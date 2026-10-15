import { build } from 'bongo';

// Prints "<epoch ms>\t<text>" for each `--debug` stage line of a build of the site at argv[2], and drops every other log line.
let mark = (text: string) => process.stdout.write(`${Date.now()}\t${text}\n`);
console.log = (...args: unknown[]) => {
	if (args[0] === '[DEBUG]' && args[1] === '[stage]') mark(String(args[2]));
};

mark('start');
await build({ cwd: process.argv[2], debug: true });
