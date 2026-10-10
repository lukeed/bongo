import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import * as css from './css';

async function makeFixtureDir(files: Record<string, string>): Promise<string> {
	let dir = join(tmpdir(), `bongo-css-test-${randomBytes(6).toString('hex')}`);
	await mkdir(dir, { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let path = join(dir, name);
			await mkdir(join(path, '..'), { recursive: true });
			await writeFile(path, contents);
		}),
	);
	return dir;
}

describe('bundle', () => {
	test('bundles a single CSS file', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { color: red; }',
		});
		try {
			let result = await css.bundle({ entry: join(dir, 'style.css') });
			let code = result.code.toString('utf8');
			expect(code).toContain('.a');
			expect(code).toContain('red');
			expect(result.dependencies).toEqual([]);
			expect(result.exports).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('bundles @import transitively and reports dependencies', async () => {
		let dir = await makeFixtureDir({
			'entry.css': `@import 'other.css';\n.a { color: red; }`,
			'other.css': '.b { color: blue; }',
		});
		try {
			let entry = join(dir, 'entry.css');
			let result = await css.bundle({ entry });
			let code = result.code.toString('utf8');
			expect(code).toContain('.a');
			expect(code).toContain('.b');
			// lightningcss inlines @import'd files; they must still be reported for the watcher
			expect(result.dependencies).toEqual([join(dir, 'other.css')]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('reports nested and parent-directory @imports', async () => {
		let dir = await makeFixtureDir({
			'site/entry.css': `@import './parts/a.css';\n@import '../shared/b.css';\n.x { color: red; }`,
			'site/parts/a.css': `@import './c.css';\n.a { color: red; }`,
			'site/parts/c.css': '.c { color: red; }',
			'shared/b.css': '.b { color: blue; }',
		});
		try {
			let result = await css.bundle({ entry: join(dir, 'site/entry.css') });
			expect(result.dependencies.sort()).toEqual([
				join(dir, 'shared/b.css'),
				join(dir, 'site/parts/a.css'),
				join(dir, 'site/parts/c.css'),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('minifies when minify=true', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a {\n  color: red;\n}\n',
		});
		try {
			let min = (await css.bundle({ entry: join(dir, 'style.css'), minify: true })).code.toString('utf8');
			let pretty = (await css.bundle({ entry: join(dir, 'style.css'), minify: false })).code.toString('utf8');
			expect(min.length).toBeLessThan(pretty.length);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('auto-enables CSS modules for *.module.css and exports class names', async () => {
		let dir = await makeFixtureDir({
			'button.module.css': '.red { color: red; }',
		});
		try {
			let result = await css.bundle({ entry: join(dir, 'button.module.css') });
			expect(result.exports).toBeDefined();
			expect(result.exports!.red).toMatch(/.+/);
			// the emitted class name should no longer be "red" verbatim (hashed by CSS modules)
			let code = result.code.toString('utf8');
			expect(code).not.toContain('.red {');
			expect(code).toContain(result.exports!.red);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('opt-in CSS modules via cssModules=true on a non-.module.css file', async () => {
		let dir = await makeFixtureDir({
			'plain.css': '.red { color: red; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'plain.css'),
				cssModules: true,
			});
			expect(result.exports).toBeDefined();
			expect(result.exports!.red).toMatch(/.+/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('accepts browserslist string for targets', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { display: grid; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'style.css'),
				targets: 'last 2 versions',
			});
			expect(result.code.toString('utf8')).toContain('grid');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('runs $assets loaders via resolver.read', async () => {
		let dir = await makeFixtureDir({
			'root.scss': '.src { color: red; }',
		});
		try {
			let scss: import('bongo').Loader = (filename, content, u) => ({
				filename: filename.replace(/\.scss$/, '.css'),
				content: (typeof content === 'string' ? content : u.decode(content))
					+ '\n.__from_loader__ { color: blue; }',
			});

			let result = await css.bundle({
				entry: join(dir, 'root.scss'),
				assets: { scss },
				utils: {
					decode: (u) => new TextDecoder().decode(u),
					render: () => '',
					frontmatter: () => ({ offset: 0, value: {} }),
				},
			});
			let code = result.code.toString('utf8');
			expect(code).toContain('.src');
			expect(code).toContain('.__from_loader__');
			// Entry path is tracked as a dep so the watcher invalidates on edit.
			expect(result.dependencies).toContain(join(dir, 'root.scss'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('forwards loader sourcemap via inputSourceMap', async () => {
		let dir = await makeFixtureDir({
			'root.scss': '.a { color: red; }',
		});
		try {
			// Minimal v3 sourcemap — lightningcss accepts it as inputSourceMap.
			let loaderMap = {
				version: 3 as const,
				sources: ['root.scss'],
				names: [],
				mappings: '',
			};
			let scss: import('bongo').Loader = (filename, content, u) => ({
				filename: filename.replace(/\.scss$/, '.css'),
				content: typeof content === 'string' ? content : u.decode(content),
				sourcemap: loaderMap,
			});

			let result = await css.bundle({
				entry: join(dir, 'root.scss'),
				sourceMap: 'inline',
				assets: { scss },
				utils: {
					decode: (u) => new TextDecoder().decode(u),
					render: () => '',
					frontmatter: () => ({ offset: 0, value: {} }),
				},
			});
			let code = result.code.toString('utf8');
			// Inline source map block appended after lightningcss composed the
			// loader's input map with its own output map.
			expect(code).toContain('sourceMappingURL=data:application/json;base64,');
			// Decode the embedded map and confirm the loader's source entry
			// survived the composition.
			let b64 = code.match(/base64,([A-Za-z0-9+/=]+)/)?.[1] ?? '';
			let decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
			expect(decoded.sources.some((s: string) => s.includes('root.scss'))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('includes inline source map when sourceMap=inline', async () => {
		let dir = await makeFixtureDir({
			'style.css': '.a { color: red; }',
		});
		try {
			let result = await css.bundle({
				entry: join(dir, 'style.css'),
				sourceMap: 'inline',
			});
			let code = result.code.toString('utf8');
			expect(code).toContain('sourceMappingURL=data:application/json;base64,');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
