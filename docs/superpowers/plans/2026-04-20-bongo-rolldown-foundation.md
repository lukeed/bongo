# Bongo Rolldown Migration — Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the "foundation" for the full rolldown migration — archive dead trees, swap pnpm/vitest for bun workspaces/bun test, and fix the broken TS config loader.

**Architecture:** Three self-contained PR-sized chunks, each green on `bun test` before the next. No changes to the live asset pipeline (that lands in the next plan covering the bundler two-pass refactor).

**Tech Stack:** Bun (runtime + test runner + workspace manager), rolldown 1.0-rc.9 (already installed), TypeScript 5.9.3. Node 24+ still supported as a fallback runtime for config loading via a temp-bundle strategy.

**Spec:** `docs/superpowers/specs/2026-04-20-bongo-rolldown-design.md` (rollout steps 1–3).

**Conventions enforced throughout this plan:**
- `import * as name from './name'` (no named imports between internal modules).
- No `any`. If an existing line already uses `any`, preserve it only to avoid scope creep; do not introduce new `any` in code this plan writes.
- `type`, never `interface`.
- `let` inside functions; `const` only for top-level constants/exports.
- `var` inside try/catch/finally blocks when the variable is assigned in a `try` and read after.

---

## File Structure

### Created by this plan

- `archive/README.md` — index of archived trees
- `docs/superpowers/plans/2026-04-20-bongo-rolldown-foundation.md` — this plan (already created)
- `packages/bongo/src/utils/config.test.ts` helpers — *new tests only*; file itself may or may not exist (it already exists under `packages/bongo/src/config.test.ts`; see Task B1 for the path decision)
- `packages/bongo/test/fixtures/config-ts-basic/bongo.config.ts` — fixture for TS config loading test

### Modified by this plan

- `package.json` (root) — workspaces, scripts, remove `vitest`
- `tsconfig.json` — exclude `archive/**`
- `packages/bongo/src/argv.test.ts` — `vitest` → `bun:test`
- `packages/bongo/src/utils.test.ts` — `vitest` → `bun:test`
- `packages/bongo/src/views.test.ts` — `vitest` → `bun:test`
- `packages/bongo/src/config.test.ts` — `vitest` → `bun:test` + expanded runtime-detection cases
- `build/size.test.ts` — `vitest` → `bun:test`
- `packages/bongo/src/utils/config.ts` — replace TS-loading branch with runtime-aware `loadModule`
- `packages/bongo/src/utils/bundler.ts` — remove broken `transform()` export

### Moved by this plan

- `rewrite/` → `archive/rewrite/`
- `packages/bongo-old/` → `archive/bongo-old/`

### Deleted by this plan

- `pnpm-workspace.yaml`

### Renamed by this plan

- Local branch `bun` → `archive/bun` (do NOT touch origin without explicit confirmation)

---

## Part A — Cleanup & Archival

### Task A1: Move `rewrite/` into `archive/`

**Files:**
- Move: `rewrite/` → `archive/rewrite/`

- [ ] **Step 1: Move the directory with `git mv`**

```bash
git mv rewrite archive/rewrite
```

- [ ] **Step 2: Verify the move**

```bash
git status
```

Expected: a list of renames under `archive/rewrite/...`.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: archive rewrite/ (superseded by packages/bongo in #9)"
```

---

### Task A2: Move `packages/bongo-old/` into `archive/`

**Files:**
- Move: `packages/bongo-old/` → `archive/bongo-old/`

- [ ] **Step 1: Move the directory with `git mv`**

```bash
git mv packages/bongo-old archive/bongo-old
```

- [ ] **Step 2: Verify the move**

```bash
git status
```

Expected: renames under `archive/bongo-old/...`.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: archive packages/bongo-old (superseded by packages/bongo)"
```

---

### Task A3: Add `archive/README.md`

**Files:**
- Create: `archive/README.md`

- [ ] **Step 1: Write the README**

Create `archive/README.md`:

```md
# archive/

Snapshots of prior iterations. Not built, not published, not part of the
workspace. Kept as reference material.

- rewrite/          — 2023–2024 rewrite; superseded by packages/bongo in PR #9
- bongo-old/        — previous published @lukeed/bongo; superseded by packages/bongo
- build-old.js      — original JS build script
- render.js         — original render entrypoint
- runtime.js        — original runtime
```

- [ ] **Step 2: Commit**

```bash
git add archive/README.md
git commit -m "chore(archive): add README index"
```

---

### Task A4: Replace `pnpm-workspace.yaml` with bun `workspaces`

**Files:**
- Delete: `pnpm-workspace.yaml`
- Modify: `package.json` (root)

- [ ] **Step 1: Delete `pnpm-workspace.yaml`**

```bash
git rm pnpm-workspace.yaml
```

- [ ] **Step 2: Replace root `package.json` contents**

Overwrite `package.json` with:

```json
{
  "private": true,
  "workspaces": [
    "build",
    "demo123",
    "packages/*"
  ],
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "bun build/index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/node": "22.13.14",
    "bump": "1.0.0-next.1",
    "sirv": "1.0.19",
    "typescript": "5.9.3"
  }
}
```

Note: `vitest` is intentionally removed — it will be reintroduced via `bun test` in Part B. Do not re-run `bun install` yet; we do that once after Part B, when all vitest imports are also gone.

- [ ] **Step 3: Verify `packages/create-bongo/template` does not have a root `package.json`**

```bash
ls packages/create-bongo/template/
```

Expected: `package.json` is present in the listing.

If `packages/create-bongo/template/package.json` exists, bun will treat the template as a nested workspace. Decide in this step:

- If it is a real template (meant to be scaffolded into a user project), rename it to `package.template.json` and update the `create-bongo` CLI to rename on scaffold. **Defer this if it requires code changes to the CLI** — just record the follow-up task in the commit message and move on.
- If it is not actually a workspace-eligible package (e.g. it has `"private": true` and no build scripts), add a `"workspaces": ["..."]`-compatible exclusion. Bun's `workspaces` field does not support negative globs. The pragmatic fix is the rename above.

For this task: if the file exists, rename it.

```bash
# Only if packages/create-bongo/template/package.json exists:
git mv packages/create-bongo/template/package.json packages/create-bongo/template/package.template.json
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml
# also add the template rename if it happened:
git add -A packages/create-bongo/template/ 2>/dev/null || true
git commit -m "chore: switch to bun workspaces"
```

---

### Task A5: Update `tsconfig.json` exclude

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Add `archive/**` and `build/**` compiled outputs to exclude**

Current `tsconfig.json` exclude:

```json
"exclude": [
  "node_modules",
  "packages/bongo/index.js"
]
```

Change to:

```json
"exclude": [
  "node_modules",
  "**/node_modules",
  "archive/**",
  "packages/bongo/index.js",
  "packages/bongo/bin.js",
  "packages/plugin.markdown/index.js",
  "packages/create-bongo/bin.js",
  "packages/create-bongo/index.js",
  "packages/create-bongo/template/**"
]
```

The full tsconfig after this edit:

```json
{
  "compilerOptions": {
    "module": "esnext",
    "target": "es2023",
    "noImplicitAny": true,
    "resolveJsonModule": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "moduleResolution": "node",
    "strictNullChecks": true,
    "removeComments": true,
    "sourceMap": false,
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "bongo": ["./packages/bongo/index.d.ts"],
      "rolldown": ["./packages/bongo/node_modules/rolldown/dist/index.d.mts"],
      "rolldown/utils": ["./packages/bongo/node_modules/rolldown/dist/utils-index.d.mts"]
    }
  },
  "include": [
    "packages"
  ],
  "exclude": [
    "node_modules",
    "**/node_modules",
    "archive/**",
    "packages/bongo/index.js",
    "packages/bongo/bin.js",
    "packages/plugin.markdown/index.js",
    "packages/create-bongo/bin.js",
    "packages/create-bongo/index.js",
    "packages/create-bongo/template/**"
  ]
}
```

- [ ] **Step 2: Verify no type errors from archived code**

```bash
bunx tsc --noEmit
```

Expected: no errors. If any error references `archive/...`, the exclude pattern is wrong — fix it.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore(tsconfig): exclude archive/ and compiled outputs"
```

---

### Task A6: Rename local `bun` branch to `archive/bun`

**Files:**
- None — git branch op only.

- [ ] **Step 1: Confirm you are not on the `bun` branch**

```bash
git branch --show-current
```

Expected: `main`. If not, checkout `main` first.

- [ ] **Step 2: Rename the local branch**

```bash
git branch -m bun archive/bun
```

- [ ] **Step 3: Verify**

```bash
git branch | grep archive/bun
```

Expected: one line — `  archive/bun`.

**No commit. This is a branch-ref op, not a working-tree change. Do not push to origin.**

---

## Part B — Test runner swap (vitest → bun:test)

Bun's `bun:test` module is API-compatible with vitest for the primitives this suite uses (`describe`, `test`, `expect`). Migration is mechanical.

### Task B1: Relocate `config.test.ts` to be co-located with the module it tests

**Context:** `packages/bongo/src/config.test.ts` currently tests `./utils/config`. Convention elsewhere in the repo is co-location — `utils/fs.ts` has no test, but `argv.test.ts` sits next to `src/` root because it uses `./utils/argv`. The spec declares tests co-located with source. Moving `config.test.ts` under `utils/` aligns with that.

**Files:**
- Move: `packages/bongo/src/config.test.ts` → `packages/bongo/src/utils/config.test.ts`

- [ ] **Step 1: Move the file**

```bash
git mv packages/bongo/src/config.test.ts packages/bongo/src/utils/config.test.ts
```

- [ ] **Step 2: Update the import path inside the moved file**

In `packages/bongo/src/utils/config.test.ts`, change:

```ts
import { merge } from './utils/config';
```

to:

```ts
import * as config from './config';
```

And change the single reference inside the test body from `merge(...)` to `config.merge(...)`. Full file after edit:

```ts
import { describe, expect, test } from 'vitest';
import * as config from './config';

function makeBase() {
	return {
		$site: { url: '', lang: '', title: '', description: '', menu: {} },
		$utils: {
			truncate: (t: string, l: number) => t.substring(0, l),
			countwords: (t: string) => t.split(/\s+/g).length,
			url: { abs: (to: string) => to },
			date: { format: (v: any) => String(v) },
		},
		$assets: {},
		$partials: {},
		plugins: [],
	} as any;
}

describe('merge', () => {
	test('merges $site properties', () => {
		let base = makeBase();
		config.merge(base, { $site: { title: 'My Site', url: 'https://example.com' } } as any);

		expect(base.$site.title).toBe('My Site');
		expect(base.$site.url).toBe('https://example.com');
		expect(base.$site.lang).toBe('');
	});

	test('merges $assets loaders', () => {
		let base = makeBase();
		let loader = () => ({});
		config.merge(base, { $assets: { md: loader } } as any);

		expect(base.$assets.md).toBe(loader);
	});

	test('merges $utils with nested objects', () => {
		let base = makeBase();
		let customAbs = (to: string) => '/custom' + to;
		config.merge(base, { $utils: { url: { abs: customAbs } } } as any);

		expect(base.$utils.url.abs).toBe(customAbs);
	});

	test('merges $utils scalar values', () => {
		let base = makeBase();
		let customTruncate = (t: string, l: number) => t.slice(0, l) + '...';
		config.merge(base, { $utils: { truncate: customTruncate } } as any);

		expect(base.$utils.truncate).toBe(customTruncate);
	});

	test('recursively merges plugins', () => {
		let base = makeBase();
		let plugin = {
			$site: { lang: 'en' },
		};
		config.merge(base, { plugins: [plugin] } as any);

		expect(base.$site.lang).toBe('en');
	});

	test('merges $partials', () => {
		let base = makeBase();
		let partial = () => 'rendered';
		config.merge(base, { $partials: { header: partial } } as any);

		expect(base.$partials.header).toBe(partial);
	});
});
```

Note: `as any` casts are preserved from the original file — they were there before this plan, and scope creep to remove them belongs in a future PR.

- [ ] **Step 3: Commit**

```bash
git add packages/bongo/src/config.test.ts packages/bongo/src/utils/config.test.ts
git commit -m "refactor: co-locate config.test.ts under utils/"
```

---

### Task B2: Swap `vitest` → `bun:test` in every test file

**Files:**
- Modify: `packages/bongo/src/argv.test.ts`
- Modify: `packages/bongo/src/utils.test.ts`
- Modify: `packages/bongo/src/views.test.ts`
- Modify: `packages/bongo/src/utils/config.test.ts`
- Modify: `build/size.test.ts`

- [ ] **Step 1: Edit each file's first import line**

In each of the five files, change:

```ts
import { describe, expect, test } from 'vitest';
```

to:

```ts
import { describe, expect, test } from 'bun:test';
```

That is the only change required in each file. The `describe`, `test`, and `expect` APIs are identical between vitest and `bun:test` for the surface this suite uses.

- [ ] **Step 2: Verify no other vitest imports remain**

```bash
grep -rn "from 'vitest'\|from \"vitest\"" packages/ build/
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/bongo/src/argv.test.ts packages/bongo/src/utils.test.ts packages/bongo/src/views.test.ts packages/bongo/src/utils/config.test.ts build/size.test.ts
git commit -m "test: migrate vitest -> bun:test"
```

---

### Task B3: Install dependencies under bun and verify the suite runs

**Files:**
- None — environment op.

- [ ] **Step 1: Install with bun**

```bash
bun install
```

Expected: succeeds, creates/updates `bun.lock`. If a `pnpm-lock.yaml` remains in the working tree, `git rm` it in the same commit.

- [ ] **Step 2: Run the test suite under bun**

```bash
bun test
```

Expected: all existing tests pass. `argv.test.ts`, `utils.test.ts`, `views.test.ts`, `utils/config.test.ts`, `build/size.test.ts` all green.

If any test fails because it depended on a vitest-specific API (`vi.mock`, `vi.fn`, `beforeEach`, etc. not in `bun:test`'s surface), port it using `bun:test`'s equivalent — do not skip. `bun:test` does export `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `mock` (spy/fn factory), and `jest.fn()` compatibility shim. See https://bun.sh/docs/cli/test.

- [ ] **Step 3: Commit**

```bash
git add bun.lock
# If pnpm-lock.yaml still exists:
git rm pnpm-lock.yaml 2>/dev/null || true
git commit -m "chore: bun install; drop pnpm lockfile"
```

- [ ] **Step 4: Checkpoint — verify build still works**

```bash
bun run build
```

Expected: the publish-time build in `/build/` runs and produces `packages/*/index.js`. If it fails due to a bun-vs-node incompatibility in `build/`, stop and resolve before continuing — Part C assumes `bun build/index.ts` works.

---

## Part C — Config loader rework

The current `packages/bongo/src/utils/bundler.ts:transform()` uses a bare `require.extensions` monkey-patch with no `createRequire(import.meta.url)`, which is broken in ESM. Replace with a runtime-aware loader in `utils/config.ts`:

- Bun → direct `import()` (bun strips TS natively)
- Deno → direct `import()` (deno strips TS natively)
- Node → bundle config to temp `.mjs` via rolldown, then `import()`

### Task C1: Create the TS-config fixture

**Files:**
- Create: `packages/bongo/test/fixtures/config-ts-basic/bongo.config.ts`

- [ ] **Step 1: Write the fixture**

Create `packages/bongo/test/fixtures/config-ts-basic/bongo.config.ts`:

```ts
type SiteConfig = {
	$site: {
		url: string;
		title: string;
	};
};

const config: SiteConfig = {
	$site: {
		url: 'https://example.com',
		title: 'Fixture Site',
	},
};

export default config;
```

The fixture uses TS-only syntax (a `type` alias) so that a test failure meaningfully distinguishes "TS was stripped" from "the file happened to be valid JS."

- [ ] **Step 2: Commit**

```bash
git add packages/bongo/test/fixtures/config-ts-basic/bongo.config.ts
git commit -m "test(fixtures): add TS config fixture"
```

---

### Task C2: Write the failing test for the Node TS-loader path

**Files:**
- Modify: `packages/bongo/src/utils/config.test.ts` (add a new `describe` block)

The test calls a yet-to-exist export `config.loadModule(file)` and asserts the exported `default` matches the fixture.

- [ ] **Step 1: Append the new test block to `packages/bongo/src/utils/config.test.ts`**

Add these imports at the top (merge with the existing import line):

```ts
import { resolve } from 'node:path';
```

Append after the existing `describe('merge', ...)` block:

```ts
const FIXTURE_TS = resolve(
	import.meta.dirname,
	'../../test/fixtures/config-ts-basic/bongo.config.ts',
);

describe('loadModule', () => {
	test('loads a TypeScript config file and returns the default export', async () => {
		let mod = await config.loadModule(FIXTURE_TS) as { default: { $site: { url: string; title: string } } };
		expect(mod.default.$site.url).toBe('https://example.com');
		expect(mod.default.$site.title).toBe('Fixture Site');
	});

	test('loads a JavaScript config file directly', async () => {
		let file = resolve(
			import.meta.dirname,
			'../../test/fixtures/config-ts-basic/bongo.config.ts',
		);
		// Use the same fixture path but via loadModule; the .ts branch must still work
		// when the active runtime strips TS natively (bun). Test is identical semantics.
		let mod = await config.loadModule(file) as { default: { $site: { url: string } } };
		expect(mod.default.$site.url).toBe('https://example.com');
	});
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
bun test packages/bongo/src/utils/config.test.ts
```

Expected: FAIL. Error message mentions `loadModule is not a function` or similar.

---

### Task C3: Implement the `bundleConfigToTemp` helper (Node path)

**Files:**
- Modify: `packages/bongo/src/utils/config.ts`

Add a private helper that bundles the config file to a temp `.mjs` using rolldown. Externalise everything from `node_modules` (detected via rolldown's default resolver; we also pass an explicit `builtinModules`-based external).

- [ ] **Step 1: Add the helper at the top of `packages/bongo/src/utils/config.ts` (just under the existing imports)**

Prepend these imports:

```ts
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';
import { randomBytes } from 'node:crypto';
```

Add the helper function below the existing imports and above `find`:

```ts
async function bundleConfigToTemp(file: string): Promise<string> {
	let rd = await import('rolldown');

	let tmpdir = os.tmpdir();
	let name = `bongo-config-${randomBytes(6).toString('hex')}.mjs`;
	let outfile = join(tmpdir, name);

	let external = [
		/^node:/,
		...builtinModules.map(m => new RegExp(`^${m}(\\/.*)?$`)),
		// anything from node_modules stays external
		/[\\/]node_modules[\\/]/,
	];

	let bundle = await rd.rolldown({
		input: file,
		external,
		resolve: {
			conditionNames: ['import', 'node'],
			mainFields: ['module', 'main'],
		},
	});

	await bundle.write({
		file: outfile,
		format: 'esm',
		minify: false,
		sourcemap: false,
	});

	await bundle.close();
	return outfile;
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Do not commit yet** — the `loadModule` export is next and belongs in the same commit.

---

### Task C4: Implement and export `loadModule`

**Files:**
- Modify: `packages/bongo/src/utils/config.ts`

- [ ] **Step 1: Add `loadModule` to `packages/bongo/src/utils/config.ts`**

Immediately after the `bundleConfigToTemp` helper from Task C3, add:

```ts
type UnknownModule = Record<string, unknown> & { default?: unknown };

function isBun(): boolean {
	return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

function isDeno(): boolean {
	return typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';
}

export async function loadModule(file: string): Promise<UnknownModule> {
	let url = pathToFileURL(file).href;

	if (!/\.ts$/.test(file)) {
		return (await import(url)) as UnknownModule;
	}

	// Bun and Deno strip TS natively
	if (isBun() || isDeno()) {
		return (await import(url)) as UnknownModule;
	}

	// Node path: bundle to temp .mjs, then dynamic import
	let tmp = await bundleConfigToTemp(file);
	try {
		let cacheBuster = `?t=${Date.now()}`;
		return (await import(pathToFileURL(tmp).href + cacheBuster)) as UnknownModule;
	} finally {
		await fs.rm(tmp).catch(() => {});
	}
}
```

- [ ] **Step 2: Add `rm` to the `fs` import surface**

Check `packages/bongo/src/utils/fs.ts` for an exported `rm`. If it is not already exported, add one. Read the file first:

```bash
cat packages/bongo/src/utils/fs.ts
```

If `rm` is not exported, append to `packages/bongo/src/utils/fs.ts`:

```ts
import { promises as fsp } from 'node:fs';

export function rm(file: string): Promise<void> {
	return fsp.rm(file, { force: true });
}
```

(Only add the `import` line if `fs.ts` does not already import `promises as fsp`. If it does, reuse the existing alias.)

- [ ] **Step 3: Run the new tests**

```bash
bun test packages/bongo/src/utils/config.test.ts
```

Expected: the two `loadModule` tests pass. Under bun, the Bun direct-import branch runs. The Node bundle-to-temp branch is exercised in Task C7.

- [ ] **Step 4: Commit**

```bash
git add packages/bongo/src/utils/config.ts packages/bongo/src/utils/config.test.ts packages/bongo/src/utils/fs.ts
git commit -m "feat(config): runtime-aware TS config loader"
```

---

### Task C5: Rewrite `config.load()` to use `loadModule`

**Files:**
- Modify: `packages/bongo/src/utils/config.ts`

Replace the `transform()` call with the new loader.

- [ ] **Step 1: Edit `packages/bongo/src/utils/config.ts`**

Remove this import line:

```ts
import { transform } from './bundler';
```

In the `load()` function body, replace:

```ts
	if (file) {
		let user = /\.ts$/.test(file)
			? await transform(file)
			: await fs.load(file);

		// TODO: validate $site keys
		merge(output, user.default || user);
	} else {
		throw new Error('Missing configuration file');
	}
```

with:

```ts
	if (file) {
		let user = await loadModule(file);

		// TODO: validate $site keys
		merge(output, (user.default as Partial<Config>) || (user as Partial<Config>));
	} else {
		throw new Error('Missing configuration file');
	}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the full suite**

```bash
bun test
```

Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/bongo/src/utils/config.ts
git commit -m "refactor(config): use loadModule for all config files"
```

---

### Task C6: Remove the broken `transform()` export from `bundler.ts`

**Files:**
- Modify: `packages/bongo/src/utils/bundler.ts`

- [ ] **Step 1: Delete the `transform()` function and its `oxcTransformSync` var**

In `packages/bongo/src/utils/bundler.ts`, delete:

1. Line 21–22:

```ts
// rolldown/utils transformSync for config loading
let oxcTransformSync: Function;
```

2. Lines 119–143 (the entire `export async function transform(filename: string) { ... }` block).

After the edit, `bundler.ts` no longer exports `transform`. The remaining `prebuild` / `build` / `postbuild` API stays (it will be replaced in the next plan).

- [ ] **Step 2: Verify nothing else imports `transform` from `./bundler`**

```bash
grep -rn "from './bundler'\|from \"./bundler\"" packages/bongo/src/ | grep -i transform
```

Expected: no output.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run the full suite**

```bash
bun test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/bongo/src/utils/bundler.ts
git commit -m "refactor(bundler): remove broken transform(); moved to config.loadModule"
```

---

### Task C7: Add an explicit test for the Node bundle-to-temp path

**Files:**
- Modify: `packages/bongo/src/utils/config.test.ts`

Under bun, the earlier `loadModule` test exercises the Bun direct-import branch. This task forces the Node branch by temporarily shadowing `globalThis.Bun` and `globalThis.Deno` so `isBun()` / `isDeno()` return false — and then verifies the temp file is cleaned up.

- [ ] **Step 1: Write the failing test**

Append to `packages/bongo/src/utils/config.test.ts`:

```ts
describe('loadModule (forced Node path)', () => {
	test('bundles TS config via rolldown and cleans up the temp file', async () => {
		let g = globalThis as { Bun?: unknown; Deno?: unknown };
		let savedBun = g.Bun;
		let savedDeno = g.Deno;
		g.Bun = undefined;
		g.Deno = undefined;

		let tmpBefore = await import('node:fs/promises').then(
			m => m.readdir(await import('node:os').then(o => o.tmpdir())),
		);

		try {
			let mod = await config.loadModule(FIXTURE_TS) as {
				default: { $site: { url: string } };
			};
			expect(mod.default.$site.url).toBe('https://example.com');
		} finally {
			g.Bun = savedBun;
			g.Deno = savedDeno;
		}

		let tmpAfter = await import('node:fs/promises').then(
			m => m.readdir(await import('node:os').then(o => o.tmpdir())),
		);

		let leaked = tmpAfter.filter(f => f.startsWith('bongo-config-') && !tmpBefore.includes(f));
		expect(leaked).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test**

```bash
bun test packages/bongo/src/utils/config.test.ts
```

Expected: the new test passes. The Node path runs because `isBun()` and `isDeno()` see `undefined` on `globalThis`. The temp file is created, imported, and removed.

If the test fails because `bundleConfigToTemp` throws (e.g., rolldown cannot resolve a TS entry), inspect the error. Common cause: rolldown needs `resolve.extensions` to include `.ts`. If so, update `bundleConfigToTemp` in `packages/bongo/src/utils/config.ts` to pass:

```ts
		resolve: {
			extensions: ['.ts', '.mjs', '.js', '.cjs', '.json'],
			conditionNames: ['import', 'node'],
			mainFields: ['module', 'main'],
		},
```

Re-run until green.

- [ ] **Step 3: Commit**

```bash
git add packages/bongo/src/utils/config.test.ts packages/bongo/src/utils/config.ts
git commit -m "test(config): cover Node bundle-to-temp TS loader path"
```

---

## Part D — Finalisation

### Task D1: Full-suite smoke check

**Files:**
- None — verification only.

- [ ] **Step 1: Clean rebuild**

```bash
rm -rf packages/*/node_modules node_modules
bun install
```

- [ ] **Step 2: Full test run**

```bash
bun test
```

Expected: every test file green. Coverage is not a gate for this plan — coverage work lands with the bundler refactor in the next plan.

- [ ] **Step 3: Full build**

```bash
bun run build
```

Expected: `packages/bongo/index.js`, `packages/plugin.markdown/index.js`, `packages/create-bongo/index.js`, `packages/create-bongo/bin.js` all produced via rolldown.

- [ ] **Step 4: Manual e2e smoke on `demo123/`**

```bash
cd demo123
bun ../packages/bongo/bin.js build
```

Expected: `demo123/public/` populated. Errors here often indicate a regression in the config loader or the stale `transform()` removal — trace back before declaring the plan done.

```bash
cd ..
```

- [ ] **Step 5: Confirm the branch is ready for review**

```bash
git log --oneline main..HEAD
git diff main --stat
```

Expected: a clean linear series of small, intention-revealing commits from Part A through Part C.

---

### Task D2: Note follow-ups in the spec's Open Questions section

**Files:**
- Modify: `docs/superpowers/specs/2026-04-20-bongo-rolldown-design.md` (Open Questions section only)

Anything surfaced during this plan (e.g. decisions about `packages/create-bongo/template/package.json`, rolldown resolver quirks, bun-test API gaps) gets logged under "Open questions" so future plans start with accurate state.

- [ ] **Step 1: Append newly-discovered follow-ups**

Open `docs/superpowers/specs/2026-04-20-bongo-rolldown-design.md` and, under the existing `## Open questions` heading, append any bullets discovered during Tasks A4, C3, or C7. Example format:

```md
- **`bundleConfigToTemp` resolver extensions.** Rolldown's default resolver does not include `.ts` for entry files unless explicitly configured. `packages/bongo/src/utils/config.ts` passes an explicit `resolve.extensions` list; if rolldown changes defaults in a later RC, revisit.
```

Only add bullets for things actually discovered. If nothing surfaced, skip this task.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-20-bongo-rolldown-design.md
git commit -m "docs(spec): note follow-ups surfaced during foundation plan"
```

---

### Task D3: Do NOT push to origin yet

**Files:**
- None.

- [ ] **Step 1: Leave the branch unpushed unless the user explicitly asks.**

The user's global rule is "do not `git push` unless i explicitly tell you do." Origin-side branch cleanup (deleting agent-generated PR heads, renaming `origin/bun` → `origin/archive/bun`) is **also** deferred until explicit confirmation. Surface both as questions when this plan is complete:

- "Push the foundation branch to origin as a PR?"
- "Delete the closed-PR agent heads on origin (`01KKNCXPQJVP9GVS811CDW9EDR`, `01KKNF4YAECHYASH7AAXHC89XZ`, `01KKPJJWPDT4PZ86A1EKJQNQ4S`, `01KKPKD1JPDHTTM7Q025MTT2EM`)?"
- "Rename `origin/bun` → `origin/archive/bun`?"

---

## Out of scope (next plan)

- Bundler API refactor — `register` / `flush` / `resolve` two-pass surface, placeholder tokens, group batching by config hash.
- LightningCSS integration — `utils/css.ts` and CSS-route through it.
- `publicPath` restoration.
- `views.ts` → `templates.ts` rename and full namespace-import normalisation.
- Dev-mode watch and HMR.
- `readme.md` updates.
- Adding `utils/bundler.test.ts`, `utils/css.test.ts`, `utils/templates.test.ts`, `build.test.ts`, `dev.test.ts`.
- Coverage target enforcement.

Those land in `docs/superpowers/plans/2026-MM-DD-bongo-bundler-refactor.md` (next plan to author after this one is green on main).
