import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as packages from './packages';

async function fixture(files: Record<string, string | object>): Promise<string> {
	let dir = realpathSync(await mkdtemp(join(tmpdir(), 'bongo-packages-')));
	for (let [name, value] of Object.entries(files)) {
		await mkdir(join(dir, name, '..'), { recursive: true });
		await writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
	}
	return dir;
}

describe('stylesheet', () => {
	test('takes the style condition before default, import, and require', async () => {
		let dir = await fixture({
			'node_modules/theme/package.json': {
				name: 'theme',
				exports: { '.': { import: './a.mjs', require: './a.cjs', style: './dist/a.css', default: './a.js' } },
			},
			'node_modules/theme/a.mjs': '',
			'node_modules/theme/a.cjs': '',
			'node_modules/theme/a.js': '',
			'node_modules/theme/dist/a.css': '',
		});
		try {
			expect(packages.stylesheet('theme', join(dir, 'assets/style.css'))).toBe(join(dir, 'node_modules/theme/dist/a.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('takes a .css default target and its subpaths, as @twinkleplop/theme-github exports them', async () => {
		let dir = await fixture({
			'node_modules/@twinkleplop/theme-github/package.json': {
				name: '@twinkleplop/theme-github',
				exports: {
					'.': { types: './dist/index.d.ts', default: './dist/index.css' },
					'./dark': { types: './dist/dark.d.ts', default: './dist/dark.css' },
					'./tokens': { types: './dist/tokens.d.ts', import: './dist/tokens.js', default: './dist/tokens.js' },
				},
			},
			'node_modules/@twinkleplop/theme-github/dist/index.css': '',
			'node_modules/@twinkleplop/theme-github/dist/dark.css': '',
			'node_modules/@twinkleplop/theme-github/dist/tokens.js': '',
		});
		try {
			let from = join(dir, 'assets/style.css');
			let root = join(dir, 'node_modules/@twinkleplop/theme-github');
			expect(packages.stylesheet('@twinkleplop/theme-github', from)).toBe(join(root, 'dist/index.css'));
			expect(packages.stylesheet('@twinkleplop/theme-github/dark', from)).toBe(join(root, 'dist/dark.css'));
			expect(packages.stylesheet('@twinkleplop/theme-github/tokens', from)).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('maps deep subpaths through exports patterns', async () => {
		let dir = await fixture({
			'node_modules/theme/package.json': {
				name: 'theme',
				exports: { './themes/*': { style: './dist/themes/*.css', default: './dist/themes/*.js' } },
			},
			'node_modules/theme/dist/themes/night/blue.css': '',
			'node_modules/theme/dist/themes/night/blue.js': '',
		});
		try {
			expect(packages.stylesheet('theme/themes/night/blue', join(dir, 'a.css'))).toBe(join(dir, 'node_modules/theme/dist/themes/night/blue.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('takes import and require targets only when they are .css files', async () => {
		let dir = await fixture({
			'node_modules/theme/package.json': {
				name: 'theme',
				exports: {
					'.': { import: './theme.mjs', require: './theme.css' },
					'./alt': { import: './alt.css', require: './alt.cjs' },
					'./js': { import: './js.mjs', require: './js.cjs' },
				},
			},
			'node_modules/theme/theme.mjs': '',
			'node_modules/theme/theme.css': '',
			'node_modules/theme/alt.css': '',
			'node_modules/theme/alt.cjs': '',
			'node_modules/theme/js.mjs': '',
			'node_modules/theme/js.cjs': '',
		});
		try {
			let from = join(dir, 'a.css');
			expect(packages.stylesheet('theme', from)).toBe(join(dir, 'node_modules/theme/theme.css'));
			expect(packages.stylesheet('theme/alt', from)).toBe(join(dir, 'node_modules/theme/alt.css'));
			expect(packages.stylesheet('theme/js', from)).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('falls back to the style field when exports has no stylesheet', async () => {
		let dir = await fixture({
			'node_modules/ui/package.json': { name: 'ui', exports: { '.': './index.js' }, style: 'dist/ui.css' },
			'node_modules/ui/index.js': '',
			'node_modules/ui/dist/ui.css': '',
			'node_modules/legacy/package.json': { name: 'legacy', main: 'index.js', style: './legacy.css' },
			'node_modules/legacy/legacy.css': '',
		});
		try {
			let from = join(dir, 'a.css');
			expect(packages.stylesheet('ui', from)).toBe(join(dir, 'node_modules/ui/dist/ui.css'));
			expect(packages.stylesheet('legacy', from)).toBe(join(dir, 'node_modules/legacy/legacy.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('falls back to the subpath as a file in the package', async () => {
		let dir = await fixture({
			'node_modules/ui/package.json': { name: 'ui', exports: { '.': './index.js' } },
			'node_modules/ui/index.js': '',
			'node_modules/ui/dist/theme.css': '',
			'node_modules/bare/theme.css': '',
		});
		try {
			let from = join(dir, 'a.css');
			expect(packages.stylesheet('ui/dist/theme.css', from)).toBe(join(dir, 'node_modules/ui/dist/theme.css'));
			expect(packages.stylesheet('bare/theme.css', from)).toBe(join(dir, 'node_modules/bare/theme.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('searches node_modules upward from the importing file, nearest first', async () => {
		let dir = await fixture({
			'node_modules/theme/package.json': { name: 'theme', style: 'hoisted.css' },
			'node_modules/theme/hoisted.css': '',
			'packages/blog/node_modules/theme/package.json': { name: 'theme', style: 'nested.css' },
			'packages/blog/node_modules/theme/nested.css': '',
		});
		try {
			expect(packages.stylesheet('theme', join(dir, 'packages/blog/assets/deep/a.css'))).toBe(join(dir, 'packages/blog/node_modules/theme/nested.css'));
			expect(packages.stylesheet('theme', join(dir, 'packages/docs/assets/a.css'))).toBe(join(dir, 'node_modules/theme/hoisted.css'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('follows symlinks, so a package resolves its own imports from where it really is', async () => {
		let store = 'node_modules/.store/theme@1/node_modules';
		let dir = await fixture({
			[`${store}/theme/package.json`]: { name: 'theme', exports: { '.': { style: './theme.css' } } },
			[`${store}/theme/theme.css`]: '',
			[`${store}/core/package.json`]: { name: 'core', style: 'core.css' },
			[`${store}/core/core.css`]: '',
		});
		try {
			await symlink(join(dir, store, 'theme'), join(dir, 'node_modules/theme'));
			let theme = packages.stylesheet('theme', join(dir, 'assets/a.css'));
			expect(theme).toBe(join(dir, store, 'theme/theme.css'));
			expect(packages.stylesheet('core', theme!)).toBe(join(dir, store, 'core/core.css'));
			expect(packages.stylesheet('core', join(dir, 'assets/a.css'))).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('returns undefined when nothing resolves', async () => {
		let dir = await fixture({
			'node_modules/js/package.json': { name: 'js', exports: { '.': './index.js' }, main: 'index.js' },
			'node_modules/js/index.js': '',
			'node_modules/js/dist/a.css': '',
			'node_modules/@scope/x/x.css': '',
		});
		try {
			let from = join(dir, 'a.css');
			expect(packages.stylesheet('nope', from)).toBeUndefined();
			expect(packages.stylesheet('js', from)).toBeUndefined();
			expect(packages.stylesheet('js/dist', from)).toBeUndefined();
			expect(packages.stylesheet('js/dist/gone.css', from)).toBeUndefined();
			expect(packages.stylesheet('@scope', from)).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('names a package.json that is not valid JSON', async () => {
		let dir = await fixture({ 'node_modules/broken/package.json': '{ nope' });
		try {
			expect(() => packages.stylesheet('broken', join(dir, 'a.css'))).toThrow(join(dir, 'node_modules/broken/package.json'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
