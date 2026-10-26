import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
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
			// a hash that starts with a digit is escaped in the selector, like `.-\35 46fa_red`
			let code = result.code.toString('utf8').replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
			expect(code).not.toContain('.red {');
			expect(code).toContain(result.exports!.red);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('a class that composes others exports every name it needs, as CSS modules in JavaScript do', async () => {
		let dir = await makeFixtureDir({
			'button.module.css': '.base { color: red; }\n.btn { composes: base; font-weight: bold; }',
		});
		try {
			let { exports } = await css.bundle({ entry: join(dir, 'button.module.css') });
			expect(exports!.btn).toBe(`${exports!.btn.split(' ')[0]} ${exports!.base}`);
			expect(exports!.btn.split(' ')[0]).toEndWith('_btn');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('classes() gives the names that bundle() ships, and bundle() takes over its compile once', async () => {
		let dir = await makeFixtureDir({
			'button.module.css': '.red { color: red; }',
		});
		let opts = { entry: join(dir, 'button.module.css'), minify: true, targets: 'defaults', url: async (file: string) => file };
		try {
			let { names, files } = await css.classes(opts);
			expect(files).toEqual([opts.entry]);
			await writeFile(opts.entry, '.red { color: blue; }');
			let shared = await css.bundle(opts);
			expect(shared.exports).toEqual(names);
			expect(shared.code.toString()).toContain('color:red');
			let fresh = await css.bundle(opts);
			expect(fresh.code.toString()).toContain('color:#00f');
		} finally {
			css.forget();
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('classes() refuses a stylesheet that is not a CSS module, since its names ship as written', async () => {
		let dir = await makeFixtureDir({
			'plain.css': '.red { color: red; }',
		});
		try {
			await expect(css.classes({ entry: join(dir, 'plain.css') })).rejects.toThrow('is not a CSS module; name it *.module.css');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('forget() drops a compile that no bundle took over', async () => {
		let dir = await makeFixtureDir({
			'button.module.css': '.red { color: red; }',
		});
		let opts = { entry: join(dir, 'button.module.css') };
		try {
			await css.classes(opts);
			await writeFile(opts.entry, '.red { color: blue; }');
			css.forget();
			expect((await css.bundle(opts)).code.toString()).toContain('color: #00f');
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

	test('runs $loaders via resolver.read', async () => {
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
					attrs: () => ({}),
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
					attrs: () => ({}),
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

describe('bundle — url() assets', () => {
	let urls = (dir: string, seen: string[] = []) => async (file: string) => {
		seen.push(file);
		return '/out/' + file.slice(dir.length + 1).replace(/\//g, '_');
	};

	test('resolves each url() relative to the file that contains it, through @import', async () => {
		let dir = await makeFixtureDir({
			'entry.css': `@import './theme/fonts.css';\n.hero { background: url(img/hero.svg); }`,
			'theme/fonts.css': `@font-face { font-family: F; src: url("../fonts/f.woff2") format("woff2"); }`,
			'img/hero.svg': '<svg/>',
			'fonts/f.woff2': 'wOF2',
		});
		try {
			let seen: string[] = [];
			let result = await css.bundle({ entry: join(dir, 'entry.css'), url: urls(dir, seen) });
			let code = result.code.toString('utf8');
			expect(code).toContain('url("/out/fonts_f.woff2")');
			expect(code).toContain('url("/out/img_hero.svg")');
			expect(seen.sort()).toEqual([join(dir, 'fonts/f.woff2'), join(dir, 'img/hero.svg')]);
			expect(result.dependencies).toContain(join(dir, 'fonts/f.woff2'));
			expect(result.dependencies).toContain(join(dir, 'img/hero.svg'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('keeps query strings and fragments, and decodes escaped paths', async () => {
		let dir = await makeFixtureDir({
			'entry.css': `.a { src: url(f.woff2?v=2#iefix); } .b { background: url(icons.svg#home); } .c { background: url("with%20space.png"); }`,
			'f.woff2': 'x',
			'icons.svg': '<svg/>',
			'with space.png': 'x',
		});
		try {
			let code = (await css.bundle({ entry: join(dir, 'entry.css'), url: urls(dir) })).code.toString('utf8');
			expect(code).toContain('url("/out/f.woff2?v=2#iefix")');
			expect(code).toContain('url("/out/icons.svg#home")');
			expect(code).toContain('url("/out/with space.png")');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('leaves external, protocol-relative, data, fragment, and root urls exactly as before', async () => {
		let source = [
			'.a { background: url(https://cdn.example.com/a.png); }',
			'.b { background: url(//cdn.example.com/b.png); }',
			`.c { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"); }`,
			'.d { fill: url(#grad); }',
			'.e { background: url(/img/e.png); }',
		].join('\n');
		let dir = await makeFixtureDir({ 'entry.css': source });
		try {
			for (let minify of [false, true]) {
				let entry = join(dir, 'entry.css');
				let seen: string[] = [];
				let before = (await css.bundle({ entry, minify })).code.toString('utf8');
				let after = (await css.bundle({ entry, minify, url: urls(dir, seen) })).code.toString('utf8');
				expect(after).toBe(before);
				expect(seen).toEqual([]);
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('serializes rewritten urls like lightningcss when minifying', async () => {
		let dir = await makeFixtureDir({ 'entry.css': '.a { background: url(a.png); }', 'a.png': 'x' });
		try {
			let code = (await css.bundle({ entry: join(dir, 'entry.css'), minify: true, url: urls(dir) })).code.toString('utf8');
			expect(code).toBe('.a{background:url(/out/a.png)}');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('fails with the css file and url when a referenced file is missing', async () => {
		let dir = await makeFixtureDir({
			'entry.css': `@import './theme/fonts.css';`,
			'theme/fonts.css': `@font-face { font-family: F; src: url("../fonts/gone.woff2"); }`,
		});
		try {
			let run = css.bundle({ entry: join(dir, 'entry.css'), url: urls(dir) });
			await expect(run).rejects.toThrow('"../fonts/gone.woff2"');
			await expect(run).rejects.toThrow(join(dir, 'theme/fonts.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('bundle — package @imports', () => {
	let theme = {
		'node_modules/theme/package.json': JSON.stringify({
			name: 'theme',
			exports: {
				'.': { style: './dist/base.css', import: './index.mjs', default: './index.js' },
				'./themes/*': { style: './dist/themes/*.css', default: './dist/themes/*.js' },
			},
		}),
		'node_modules/theme/index.mjs': '',
		'node_modules/theme/index.js': '',
		'node_modules/theme/dist/base.css': '@font-face { font-family: T; src: url("../fonts/t.woff2"); }\n.base { color: red; }',
		'node_modules/theme/dist/themes/dark.css': '.dark { color: black; }',
		'node_modules/theme/fonts/t.woff2': 'wOF2',
	};

	test('bundles package stylesheets and reports them as dependencies', async () => {
		let dir = realpathSync(await makeFixtureDir({
			...theme,
			'assets/style.css': '@import "theme";\n@import "theme/themes/dark";\n.a { color: blue; }',
		}));
		try {
			let result = await css.bundle({ entry: join(dir, 'assets/style.css') });
			let code = result.code.toString('utf8');
			expect(code).toContain('.base');
			expect(code).toContain('.dark');
			expect(code).toContain('.a');
			expect(result.dependencies.sort()).toEqual([
				join(dir, 'node_modules/theme/dist/base.css'),
				join(dir, 'node_modules/theme/dist/themes/dark.css'),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('resolves url() in a package stylesheet against that file', async () => {
		let dir = realpathSync(await makeFixtureDir({ ...theme, 'assets/style.css': '@import "theme";' }));
		try {
			let seen: string[] = [];
			let result = await css.bundle({
				entry: join(dir, 'assets/style.css'),
				url: async file => (seen.push(file), '/out/t.woff2'),
			});
			expect(seen).toEqual([join(dir, 'node_modules/theme/fonts/t.woff2')]);
			expect(result.code.toString('utf8')).toContain('url("/out/t.woff2")');
			expect(result.dependencies).toContain(join(dir, 'node_modules/theme/fonts/t.woff2'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('prefers a file beside the css, and keeps relative and absolute imports as before', async () => {
		let dir = realpathSync(await makeFixtureDir({
			'node_modules/theme.css/package.json': JSON.stringify({ name: 'theme.css', style: 'pkg.css' }),
			'node_modules/theme.css/pkg.css': '.from-package { color: red; }',
			'assets/theme.css': '.from-local { color: red; }',
			'assets/parts/a.css': '.from-relative { color: red; }',
			'shared/b.css': '.from-absolute { color: red; }',
		}));
		try {
			await writeFile(join(dir, 'assets/style.css'), `@import "theme.css";\n@import "./parts/a.css";\n@import "${join(dir, 'shared/b.css')}";`);
			let result = await css.bundle({ entry: join(dir, 'assets/style.css') });
			let code = result.code.toString('utf8');
			expect(code).toContain('.from-local');
			expect(code).toContain('.from-relative');
			expect(code).toContain('.from-absolute');
			expect(code).not.toContain('.from-package');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('fails with the specifier and the importing file when nothing resolves', async () => {
		let dir = realpathSync(await makeFixtureDir({
			'assets/style.css': '@import "./theme/fonts.css";',
			'assets/theme/fonts.css': '@import "nope/x.css";',
		}));
		try {
			let run = css.bundle({ entry: join(dir, 'assets/style.css') });
			await expect(run).rejects.toThrow(`Cannot resolve @import "nope/x.css" in ${join(dir, 'assets/theme/fonts.css')}`);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
