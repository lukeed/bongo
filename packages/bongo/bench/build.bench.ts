// Benchmark `bongo build` end-to-end against the `demo123` fixture.
//
// Run:  bun packages/bongo/bench/build.bench.ts
//
// The bench builds demo123 in place (`demo123/public/` is gitignored). Each
// sample calls `bundler.reset()` + clears template caches so prior state
// doesn't leak between runs.

import { resolve } from 'node:path';
import { bench, run } from 'mitata';

import { build } from '../src/build';
import * as bundler from '../src/utils/bundler';
import * as templates from '../src/utils/templates';

const DEMO = resolve(import.meta.dirname, '../../../demo123');

function resetState(): void {
	bundler.reset();
	templates.Layouts.clear();
	templates.Partials.clear();
}

// Warm up — first run amortises rolldown/lightningcss native loading +
// V8 JIT warmup. The reported mean should reflect steady-state build cost.
await (async () => {
	resetState();
	await build({ cwd: DEMO });
})();

bench('build demo123', async () => {
	resetState();
	await build({ cwd: DEMO });
});

await run();
