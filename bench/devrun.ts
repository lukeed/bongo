import { heapSize, memoryUsage } from 'bun:jsc';
import { dev } from 'bongo';

// Runs `bongo dev` on the site at argv[2] and port argv[3], and prints "@mem <footprint> <js heap>" every 200 ms; both reads are cheap.
setInterval(() => process.stdout.write(`@mem ${memoryUsage().current} ${heapSize()}\n`), 200).unref();
await dev({ cwd: process.argv[2], host: '127.0.0.1', port: Number(process.argv[3]) });
