import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdir, cp, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { build } from './build';
import * as bundler from './utils/bundler';
import * as templates from './utils/templates';

const FIXTURES = join(import.meta.dirname, '../test/fixtures');
const FIXTURE_ROOT = join(FIXTURES, 'site-basic');

// Reset module-level state between tests so each build starts clean.
beforeEach(() => {
	bundler.reset();
	templates.Layouts.clear();
	templates.Partials.clear();
});

async function copyFixture(name: string): Promise<string> {
	// Copy the fixture into a temp dir so tests are isolated from each other
	// and from any stale `public/` the fixture may accrue.
	let target = join(tmpdir(), `bongo-it-${randomBytes(6).toString('hex')}`);
	await mkdir(target, { recursive: true });
	await cp(join(FIXTURES, name), target, { recursive: true });
	return target;
}

async function runBuild(): Promise<string> {
	let target = await copyFixture('site-basic');
	await build({ cwd: target });
	return target;
}

describe('integration: site-basic', () => {
	test('produces the expected output tree and substitutes every placeholder', async () => {
		let root = await runBuild();
		try {
			let out = join(root, 'public');
			expect(existsSync(out)).toBe(true);

			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');

			// Every placeholder is resolved.
			expect(indexHtml).not.toContain('__BONGO_BUNDLE');

			// External stylesheet: hashed filename referenced by link href.
			let linkMatch = indexHtml.match(/<link rel="stylesheet" href="([^"]+)"\/>/);
			expect(linkMatch).not.toBeNull();
			let linkHref = linkMatch![1];
			expect(linkHref).toMatch(/^\/style\.[\w-]+\.css$/);
			expect(existsSync(join(out, linkHref.slice(1)))).toBe(true);

			// Inline style: <style> element contains the CSS directly, no src attr.
			let inlineStyle = indexHtml.match(/<style>[^<]*\.inline-only[^<]*{/);
			expect(inlineStyle).not.toBeNull();

			// External script: hashed filename referenced by script src.
			let scriptMatch = indexHtml.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/);
			expect(scriptMatch).not.toBeNull();
			let scriptSrc = scriptMatch![1];
			expect(scriptSrc).toMatch(/^\/main\.[\w-]+\.js$/);
			expect(existsSync(join(out, scriptSrc.slice(1)))).toBe(true);

			// Inline script: element contains bundled boot content, no src attr.
			let inlineScript = indexHtml.match(/<script>[^<]*boot[^<]*<\/script>/s);
			expect(inlineScript).not.toBeNull();

			// Partial expanded.
			expect(indexHtml).toContain('Greetings, world!');

			// Content rendered.
			expect(indexHtml).toContain('Fixture page');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('respects $site.url publicPath for external URLs', async () => {
		let root = await runBuild();
		try {
			let out = join(root, 'public');
			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');

			// $site.url is 'https://example.com' (no path), so publicPath = '/'.
			// All external refs start with '/'.
			let linkMatch = indexHtml.match(/<link rel="stylesheet" href="([^"]+)"/);
			expect(linkMatch![1]).toMatch(/^\//);
			let scriptMatch = indexHtml.match(/<script[^>]*src="([^"]+)"/);
			expect(scriptMatch![1]).toMatch(/^\//);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('emits hashed filenames for JS and CSS outputs', async () => {
		let root = await runBuild();
		try {
			let out = join(root, 'public');
			let files = await readdir(out);

			let hashedCss = files.filter(f => /^\w+\.[\w-]+\.css$/.test(f));
			let hashedJs = files.filter(f => /^\w+\.[\w-]+\.js$/.test(f));

			// At least one external CSS (style.css) and one external JS (main.ts).
			// Inline-only assets may or may not be emitted depending on impl;
			// don't pin counts tightly.
			expect(hashedCss.length).toBeGreaterThanOrEqual(1);
			expect(hashedJs.length).toBeGreaterThanOrEqual(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-css-modules', () => {
	test('hashes class names in *.module.css output', async () => {
		let root = await copyFixture('site-css-modules');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');
			let files = await readdir(out);

			// One hashed CSS output from theme.module.css.
			// Filename is "theme.module.<hash>.css" — the input basename includes
			// a dot so the hash lands between "module" and the extension.
			let cssFiles = files.filter(f => /^theme\.module\.[\w-]+\.css$/.test(f));
			expect(cssFiles.length).toBe(1);

			let css = await readFile(join(out, cssFiles[0]), 'utf8');

			// Original class names are scoped/hashed by lightningcss, so the raw
			// selectors `.red` and `.blue` should NOT appear as-is in the emitted
			// bundle.
			expect(css).not.toMatch(/\.red\s*\{/);
			expect(css).not.toMatch(/\.blue\s*\{/);
			// Two hashed selectors in the output, one per source class.
			let selectors = css.match(/\.[a-zA-Z0-9_-]+_red\b/g);
			expect(selectors).not.toBeNull();
			expect(selectors!.length).toBeGreaterThan(0);
			let blueSelectors = css.match(/\.[a-zA-Z0-9_-]+_blue\b/g);
			expect(blueSelectors).not.toBeNull();
			// Font-weight rule is preserved verbatim (lightningcss may minify
			// color values like `blue` → `#00f` so we don't check those).
			expect(css).toContain('font-weight: bold');

			// HTML link still points at the hashed CSS file.
			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');
			expect(indexHtml).not.toContain('__BONGO_BUNDLE');
			let linkMatch = indexHtml.match(/<link rel="stylesheet" href="([^"]+)"/);
			expect(linkMatch).not.toBeNull();
			expect(linkMatch![1]).toMatch(/^\/theme\.module\.[\w-]+\.css$/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-build-error', () => {
	test('surfaces bundler errors with a useful message', async () => {
		let root = await copyFixture('site-build-error');
		let err: Error | null = null;
		try {
			try {
				await build({ cwd: root });
			} catch (e) {
				err = e as Error;
			}

			expect(err).not.toBeNull();
			// Top-level throw carries the count summary emitted by build.ts.
			expect(err!.message).toMatch(/Build failed/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-hbs-content', () => {
	test('.hbs content files are compiled with $site + params', async () => {
		let root = await copyFixture('site-hbs-content');
		try {
			await build({ cwd: root });

			let indexHtml = await readFile(join(root, 'public', 'index.html'), 'utf8');

			// params.title came from frontmatter
			expect(indexHtml).toContain('<h1>Greeting Page</h1>');
			// params.name + $site.title resolved inline
			expect(indexHtml).toContain('Hello, World! From HBS Content Fixture.');
			// Layout still wrapped it
			expect(indexHtml).toContain('<title>Greeting Page — HBS Content Fixture</title>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
