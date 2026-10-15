import { heapStats } from 'bun:jsc';
import { build } from 'bongo';

// Prints "<epoch ms>\t<text>\t<live heap>" for each `--debug` stage line of a build of the site at argv[2]; with `--heap`, a full GC runs before each heap reading.
let heap = process.argv.includes('--heap');
let mark = (text: string) => {
	let at = Date.now();
	if (heap) Bun.gc(true);
	process.stdout.write(`${at}\t${text}\t${heap ? heapStats().heapSize : 0}\n`);
};
console.log = (...args: unknown[]) => {
	if (args[0] === '[DEBUG]' && args[1] === '[stage]') mark(String(args[2]));
};

mark('start');
await build({ cwd: process.argv[2], debug: true });
mark('exit');
