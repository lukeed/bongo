import { heapStats } from 'bun:jsc';
import { build } from 'bongo';

type Mimalloc = {
	process: { rss_current: number };
	committed: { current: number };
	malloc_normal: { current: number };
	malloc_huge: { current: number };
};

// Prints "<epoch ms>\t<text>\t<memory JSON>" for each `--debug` stage line of a `--fresh` build of the site at argv[2]; with `--gc`, a full GC runs before each reading.
let gc = process.argv.includes('--gc');
let stage = '';
let mark = (text: string) => {
	let at = Date.now();
	// a reading takes ~25 ms on a large heap, and the next stage starts at once
	if (text.startsWith(stage + ': ')) return void process.stdout.write(`${at}\t${text}\tnull\n`);
	stage = text;
	if (gc) Bun.gc(true);
	let stats: ReturnType<typeof heapStats> & { mimalloc?: Mimalloc } = heapStats();
	let mi = stats.mimalloc;
	let memory = {
		rss: mi?.process.rss_current ?? 0,
		committed: mi?.committed.current ?? 0,
		used: mi ? mi.malloc_normal.current + mi.malloc_huge.current : 0,
		heap: stats.heapSize,
	};
	process.stdout.write(`${at}\t${text}\t${JSON.stringify(memory)}\n`);
};
console.log = (...args: unknown[]) => {
	if (args[0] === '[DEBUG]' && args[1] === '[stage]') mark(String(args[2]));
};

mark('start');
await build({ cwd: process.argv[2], debug: true, fresh: true });
mark('exit');
