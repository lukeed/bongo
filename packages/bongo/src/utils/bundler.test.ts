import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import * as bundler from './bundler';

async function tmp(files: Record<string, string>): Promise<{ dir: string; outDir: string }> {
	let dir = join(tmpdir(), `bongo-bundler-test-${randomBytes(6).toString('hex')}`);
	let outDir = join(dir, '__out');
	await mkdir(outDir, { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, contents]) => {
			let p = join(dir, name);
			await mkdir(join(p, '..'), { recursive: true });
			await writeFile(p, contents);
		}),
	);
	return { dir, outDir };
}

afterEach(() => {
	bundler.reset();
});

describe('register', () => {
	test('returns a placeholder with the expected shape', () => {
		let p = bundler.register('/a/b.ts', { kind: 'js' });
		expect(p).toMatch(/^__BONGO_BUNDLE:[a-f0-9]{16}__$/);
	});

	test('is idempotent for the same (entry, cfg)', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		let b = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		expect(a).toBe(b);
	});

	test('different entries produce different placeholders', () => {
		let a = bundler.register('/x.ts', { kind: 'js' });
		let b = bundler.register('/y.ts', { kind: 'js' });
		expect(a).not.toBe(b);
	});

	test('different configs for the same entry produce different placeholders', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm' });
		let b = bundler.register('/x.ts', { kind: 'js', format: 'cjs' });
		expect(a).not.toBe(b);
	});

	test('placeholder is stable across calls in different insertion orders', () => {
		let a = bundler.register('/x.ts', { kind: 'js', format: 'esm', minify: true });
		bundler.reset();
		let b = bundler.register('/x.ts', { kind: 'js', minify: true, format: 'esm' });
		expect(a).toBe(b);
	});
});

describe('flush() — JS', () => {
	test('bundles a single JS entry and resolves to a hashed filename', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x: number = 1;\nconsole.log(x);' });
		try {
			let p = bundler.register(join(dir, 'entry.ts'), { kind: 'js', format: 'esm' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p);
			expect(info).toBeDefined();
			// rolldown uses base62 hashes (e.g. "jxy3YN54"), not hex-only
		expect(info!.filename).toMatch(/^entry\.[\w-]+\.js$/);
			let written = await readFile(join(outDir, info!.filename), 'utf8');
			expect(written).toContain('console.log');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('batches same-config JS entries into one rolldown run', async () => {
		let { dir, outDir } = await tmp({
			'a.ts': 'export const a = 1;',
			'b.ts': 'export const b = 2;',
		});
		try {
			let pa = bundler.register(join(dir, 'a.ts'), { kind: 'js', format: 'esm' });
			let pb = bundler.register(join(dir, 'b.ts'), { kind: 'js', format: 'esm' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			expect(result.outputs.size).toBe(2);
			expect(result.outputs.get(pa)!.filename).toMatch(/^a\.[\w-]+\.js$/);
			expect(result.outputs.get(pb)!.filename).toMatch(/^b\.[\w-]+\.js$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('reports an error for a non-existent entry (no throw)', async () => {
		let { outDir } = await tmp({ 'unused.ts': '' });
		try {
			bundler.register('/definitely/not/here.ts', { kind: 'js' });
			let result = await bundler.flush({ outDir });
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.outputs.size).toBe(0);
		} finally {
			await rm(outDir, { recursive: true, force: true });
		}
	});

	test('runs $assets loaders for non-native JS extensions', async () => {
		let { dir, outDir } = await tmp({
			'app.jsx': 'let tag = <Hello/>; export { tag };',
		});
		try {
			let jsx: import('bongo').Loader = (filename, content, u) => ({
				filename: filename.replace(/\.jsx$/, '.js'),
				content: (typeof content === 'string' ? content : u.decode(content))
					.replace(/<(\w+)\s*\/>/g, (_m, t) => `"<${t}/>"`),
			});
			let p = bundler.register(join(dir, 'app.jsx'), { kind: 'js' });
			let result = await bundler.flush({
				outDir,
				assets: { jsx },
				utils: {
					decode: (u) => new TextDecoder().decode(u),
					render: () => '',
					frontmatter: () => ({ offset: 0, value: {} }),
				},
			});
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p)!;
			expect(info.filename).toMatch(/^app\.[\w-]+\.js$/);
			let written = await readFile(join(outDir, info.filename), 'utf8');
			expect(written).toContain('<Hello/>');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('forwards loader sourcemap to rolldown inline output', async () => {
		let { dir, outDir } = await tmp({
			'app.jsx': 'export let x = 1;',
		});
		try {
			let loaderMap = {
				version: 3 as const,
				sources: ['app.jsx'],
				names: [],
				mappings: 'AAAA',
			};
			let jsx: import('bongo').Loader = (filename, content, u) => ({
				filename: filename.replace(/\.jsx$/, '.js'),
				content: typeof content === 'string' ? content : u.decode(content),
				sourcemap: loaderMap,
			});
			let p = bundler.register(join(dir, 'app.jsx'), {
				kind: 'js',
				sourceMap: 'inline',
			});
			let result = await bundler.flush({
				outDir,
				assets: { jsx },
				utils: {
					decode: (u) => new TextDecoder().decode(u),
					render: () => '',
					frontmatter: () => ({ offset: 0, value: {} }),
				},
			});
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p)!;
			let written = await readFile(join(outDir, info.filename), 'utf8');
			expect(written).toMatch(/sourceMappingURL=data:application\/json[^,]*,/);
			let b64 = written.match(/base64,([A-Za-z0-9+/=]+)/)?.[1] ?? '';
			let decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
			// Loader-declared source survives rolldown's sourcemap composition.
			expect(decoded.sources.some((s: string) => s.includes('app.jsx'))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('accepts a browserslist query as target', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x = 1;' });
		try {
			bundler.register(join(dir, 'entry.ts'), { kind: 'js', target: 'last 2 versions' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			expect(result.outputs.size).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('flush() — CSS url() assets', () => {
	test('emits each referenced file once with a content hash and rewrites urls under publicPath', async () => {
		let { dir, outDir } = await tmp({
			'a.css': '@import "./theme/fonts.css";\n.a { background: url(img/hero.svg); }',
			'b.css': '.b { background: url("./img/hero.svg#icon"); }',
			'theme/fonts.css': '@font-face { font-family: F; src: url(../fonts/f.woff2) format("woff2"); }',
			'img/hero.svg': '<svg/>',
			'fonts/f.woff2': 'wOF2',
		});
		try {
			let a = bundler.register(join(dir, 'a.css'), { kind: 'css' });
			let b = bundler.register(join(dir, 'b.css'), { kind: 'css' });
			let result = await bundler.flush({ outDir, publicPath: '/docs/' });
			expect(result.errors).toEqual([]);

			let files = (await readdir(outDir)).sort();
			let svg = files.filter(f => /^hero\.[\w-]{8}\.svg$/.test(f));
			let font = files.filter(f => /^f\.[\w-]{8}\.woff2$/.test(f));
			expect(svg).toHaveLength(1);
			expect(font).toHaveLength(1);
			expect(await readFile(join(outDir, font[0]), 'utf8')).toBe('wOF2');

			let cssA = await readFile(join(outDir, result.outputs.get(a)!.filename), 'utf8');
			let cssB = await readFile(join(outDir, result.outputs.get(b)!.filename), 'utf8');
			expect(cssA).toContain(`url("/docs/${font[0]}")`);
			expect(cssA).toContain(`url("/docs/${svg[0]}")`);
			expect(cssB).toContain(`url("/docs/${svg[0]}#icon")`);
			expect(result.outputs.get(a)!.dependencies).toContain(join(dir, 'fonts/f.woff2'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('a changed asset changes both its name and the css hash', async () => {
		let { dir, outDir } = await tmp({ 'a.css': '.a { background: url(x.png); }', 'x.png': 'one' });
		try {
			let a = bundler.register(join(dir, 'a.css'), { kind: 'css' });
			let first = (await bundler.flush({ outDir })).outputs.get(a)!.filename;
			await writeFile(join(dir, 'x.png'), 'two');
			bundler.reset();
			let again = bundler.register(join(dir, 'a.css'), { kind: 'css' });
			let second = (await bundler.flush({ outDir })).outputs.get(again)!.filename;
			expect(second).not.toBe(first);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('reports a missing file as a build error naming the css file', async () => {
		let { dir, outDir } = await tmp({ 'theme.css': '.a { background: url(gone.png); }' });
		try {
			bundler.register(join(dir, 'theme.css'), { kind: 'css' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain('"gone.png"');
			expect(result.errors[0].message).toContain(join(dir, 'theme.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('flush() — files', () => {
	test('a file registration and a css url() share one hashed copy', async () => {
		let { dir, outDir } = await tmp({
			'style.css': '@font-face { font-family: F; src: url(fonts/f.woff2); }',
			'fonts/f.woff2': 'wOF2',
		});
		try {
			let font = bundler.register(join(dir, 'fonts/f.woff2'), { kind: 'file' });
			let style = bundler.register(join(dir, 'style.css'), { kind: 'css' });
			let result = await bundler.flush({ outDir, publicPath: '/docs/' });
			expect(result.errors).toEqual([]);

			let copies = (await readdir(outDir)).filter(f => f.endsWith('.woff2'));
			expect(copies).toHaveLength(1);
			expect(result.outputs.get(font)).toEqual({ filename: copies[0], dependencies: [join(dir, 'fonts/f.woff2')] });
			let css = await readFile(join(outDir, result.outputs.get(style)!.filename), 'utf8');
			expect(css).toContain(`url("${bundler.href('/docs/', copies[0])}")`);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('href percent-encodes names so urls are safe in css and html attributes', () => {
		expect(bundler.href('/', 'style.ab12cd34.css')).toBe('/style.ab12cd34.css');
		expect(bundler.href('/docs/', "my font's (bold).1a2b3c4d.woff2")).toBe('/docs/my%20font%27s%20%28bold%29.1a2b3c4d.woff2');
	});
});

describe('flush() — CSS', () => {
	test('emits a hashed CSS file and reports dependencies', async () => {
		let { dir, outDir } = await tmp({
			'style.css': '@import "shared.css";\n.a { color: red; }',
			'shared.css': '.b { color: blue; }',
		});
		try {
			let p = bundler.register(join(dir, 'style.css'), { kind: 'css', minify: true });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p);
			expect(info).toBeDefined();
			expect(info!.filename).toMatch(/^style\.[\w-]+\.css$/);
			let written = await readFile(join(outDir, info!.filename), 'utf8');
			expect(written).toContain('.a');
			expect(written).toContain('.b');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('auto-enables CSS modules for *.module.css', async () => {
		let { dir, outDir } = await tmp({
			'button.module.css': '.red { color: red; }',
		});
		try {
			let p = bundler.register(join(dir, 'button.module.css'), { kind: 'css' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toEqual([]);
			let info = result.outputs.get(p)!;
			expect(info.exports).toBeDefined();
			expect(info.exports!.red).toMatch(/.+/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('flush() error reporting', () => {
	test('propagates location info from rolldown errors', async () => {
		let { dir, outDir } = await tmp({
			'broken.ts': 'export const x: number = ;\n// intentional syntax error',
		});
		try {
			bundler.register(join(dir, 'broken.ts'), { kind: 'js' });
			let result = await bundler.flush({ outDir });
			expect(result.errors).toHaveLength(1);
			let err = result.errors[0];
			expect(err.message).toMatch(/^\[PARSE_ERROR\] .*Unexpected token$/);
			expect(err.file).toEndWith('broken.ts');
			expect(err).toMatchObject({ line: 1, column: 25 });
			expect(err.frame).toContain('export const x: number = ;');
			expect(JSON.stringify(err)).not.toContain('\\u001b');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('reset()', () => {
	test('clears registrations and outputs', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x = 1;' });
		try {
			let p = bundler.register(join(dir, 'entry.ts'), { kind: 'js' });
			let before = await bundler.flush({ outDir });
			expect(before.outputs.get(p)).toBeDefined();
			bundler.reset();
			let after = await bundler.flush({ outDir });
			expect(after.outputs.size).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('watch()', () => {
	test('returns an Unsubscribe function', async () => {
		let { dir, outDir } = await tmp({ 'entry.ts': 'export const x = 1;' });
		try {
			bundler.register(join(dir, 'entry.ts'), { kind: 'js' });
			await bundler.flush({ outDir });
			let unsub = await bundler.watch(() => {});
			expect(typeof unsub).toBe('function');
			unsub();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('follows dependencies found later, in directories outside the entry', async () => {
		let { dir, outDir } = await tmp({
			'site/style.css': '.a { color: red; }',
			'shared/part.css': '.b { color: blue; }',
		});
		let changed: string[] = [];
		let unsub = () => {};
		try {
			let entry = join(dir, 'site/style.css');
			bundler.register(entry, { kind: 'css' });
			await bundler.flush({ outDir });
			unsub = await bundler.watch(diff => { changed.push(diff.file); });

			await writeFile(entry, '@import "../shared/part.css";\n.a { color: red; }');
			await bundler.flush({ outDir });
			await new Promise(r => setTimeout(r, 150));

			let part = join(dir, 'shared/part.css');
			await writeFile(part, '.b { color: green; }');
			let start = Date.now();
			while (!changed.includes(part) && Date.now() - start < 3000) {
				await new Promise(r => setTimeout(r, 20));
			}
			expect(changed).toContain(part);
		} finally {
			unsub();
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('rebuilds when a file referenced by url() changes', async () => {
		let { dir, outDir } = await tmp({
			'site/style.css': '.a { background: url(../media/bg.png); }',
			'media/bg.png': 'one',
		});
		let changed: string[] = [];
		let unsub = () => {};
		try {
			bundler.register(join(dir, 'site/style.css'), { kind: 'css' });
			await bundler.flush({ outDir });
			unsub = await bundler.watch(diff => { changed.push(diff.file); });
			await new Promise(r => setTimeout(r, 150));

			let bg = join(dir, 'media/bg.png');
			await writeFile(bg, 'two');
			let start = Date.now();
			while (!changed.includes(bg) && Date.now() - start < 3000) {
				await new Promise(r => setTimeout(r, 20));
			}
			expect(changed).toContain(bg);
		} finally {
			unsub();
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('hmr()', () => {
	test('pushes error messages to the registered sender', async () => {
		let messages: unknown[] = [];
		bundler.hmr((msg) => { messages.push(msg); });
		bundler.register('/definitely/not/here.ts', { kind: 'js' });
		let { outDir } = await tmp({ 'unused.ts': '' });
		try {
			let result = await bundler.flush({ outDir });
			expect(result.errors.length).toBeGreaterThan(0);
			expect(messages.length).toBeGreaterThan(0);
			let first = messages[0] as { type: string; errors: unknown[] };
			expect(first.type).toBe('error');
			expect(Array.isArray(first.errors)).toBe(true);
		} finally {
			await rm(outDir, { recursive: true, force: true });
		}
	});
});
