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

describe('integration: site-hooks', () => {
	test('hooks can annotate page context and emit extra output files', async () => {
		let root = await copyFixture('site-hooks');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');
			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');
			let postHtml = await readFile(join(out, 'blog', 'post', 'index.html'), 'utf8');
			let manifest = await readFile(join(out, 'hook-manifest.txt'), 'utf8');

			expect(indexHtml).toContain('<link rel="alternate" type="application/rss+xml" title="Hook Feed" href="https://example.com/feed.xml">');
			expect(postHtml).toContain('<link rel="alternate" type="application/rss+xml" title="Hook Feed" href="https://example.com/feed.xml">');
			expect(manifest).toBe('/\n/blog/post/');
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

describe('integration: site-loaders', () => {
	test('routes <bongo:style src="*.scss"> through user loader chain', async () => {
		let root = await copyFixture('site-loaders');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');
			let files = await readdir(out);

			// One hashed CSS output derived from main.scss → main.css.
			let cssFiles = files.filter(f => /^main\.[\w-]+\.css$/.test(f));
			expect(cssFiles.length).toBe(1);

			let css = await readFile(join(out, cssFiles[0]), 'utf8');
			// Marker rules appended by the pseudo-scss loader. One per file —
			// both the entry (main.scss) and the @import'd shared.scss ran
			// through the loader chain, not just one.
			expect(css).toMatch(/\.__loaded_main__/);
			expect(css).toMatch(/\.__loaded_shared__/);
			// Source .scss file content passed through.
			expect(css).toMatch(/\.shared/);
			expect(css).toMatch(/\.card/);

			// HTML link points at the hashed CSS file — not at main.scss.
			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');
			expect(indexHtml).not.toContain('__BONGO_BUNDLE');
			expect(indexHtml).not.toContain('main.scss');
			let linkMatch = indexHtml.match(/<link rel="stylesheet" href="([^"]+)"/);
			expect(linkMatch).not.toBeNull();
			expect(linkMatch![1]).toMatch(/^\/main\.[\w-]+\.css$/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('routes <bongo:script src="*.jsx"> through user loader chain', async () => {
		let root = await copyFixture('site-loaders');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');
			let files = await readdir(out);

			let jsFiles = files.filter(f => /^app\.[\w-]+\.js$/.test(f));
			expect(jsFiles.length).toBe(1);

			let js = await readFile(join(out, jsFiles[0]), 'utf8');
			// Loader-emitted marker survives rolldown.
			expect(js).toContain('__LOADER_JSX_MARKER__');
			// The jsx literal was transformed into a string by the loader, not
			// left raw for rolldown (which would fail to parse `<Hello/>` as JS).
			expect(js).toContain('<Hello/>');

			let indexHtml = await readFile(join(out, 'index.html'), 'utf8');
			expect(indexHtml).not.toContain('app.jsx');
			let scriptMatch = indexHtml.match(/<script[^>]*src="([^"]+)"/);
			expect(scriptMatch).not.toBeNull();
			expect(scriptMatch![1]).toMatch(/^\/app\.[\w-]+\.js$/);
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

	test('.hbs content bodies can read $page, $section, and $page.tags', async () => {
		let root = await copyFixture('site-hbs-content');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			// Blog index's body iterates $section — should list all three blog pages.
			let blogIndex = await readFile(join(out, 'blog', 'index.html'), 'utf8');
			expect(blogIndex).toContain('data-section="blog"');
			expect(blogIndex).toContain('data-path="/blog/"');
			expect(blogIndex).toContain('data-path="/blog/post-a/"');
			expect(blogIndex).toContain('data-path="/blog/post-b/"');

			// Post A's body reads $page.tags to derive a data-tags attribute
			// and $page.tags.length.
			let postA = await readFile(join(out, 'blog', 'post-a', 'index.html'), 'utf8');
			expect(postA).toContain('data-tags="alpha,demo"');
			expect(postA).toContain('This page has 2 tags.');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-sections', () => {
	test('exposes $pages and $section in templates; sets $page.section', async () => {
		let root = await copyFixture('site-sections');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');

			// Blog index lists siblings via $section iteration.
			// The index path is '/blog/' (index.* stripping adds no suffix, just strips 'index').
			let blogIndex = await readFile(join(out, 'blog', 'index.html'), 'utf8');
			expect(blogIndex).toContain('data-path="/blog/post-1/"');
			expect(blogIndex).toContain('data-path="/blog/post-2/"');
			// The index itself is a member of the section — its own path appears too.
			expect(blogIndex).toContain('data-path="/blog/"');

			// The root layout reads $page.section — blog pages have section='blog'.
			expect(blogIndex).toContain('data-section="blog"');

			// Home page's section is '' (root).
			let homeHtml = await readFile(join(out, 'index.html'), 'utf8');
			expect(homeHtml).toContain('data-section=""');

			// A leaf post renders via single.hbs (fallback chain) with its own content.
			let post1 = await readFile(join(out, 'blog', 'post-1', 'index.html'), 'utf8');
			expect(post1).toContain('First Post');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-tags', () => {
	test('exposes $tags in layout and $page.tags per page', async () => {
		let root = await copyFixture('site-tags');
		try {
			await build({ cwd: root });

			let out = join(root, 'public');

			// Post A has tags food + travel.
			let postA = await readFile(join(out, 'post-a', 'index.html'), 'utf8');
			expect(postA).toContain('data-tags="food,travel"');

			// Post B has tags travel + tech.
			let postB = await readFile(join(out, 'post-b', 'index.html'), 'utf8');
			expect(postB).toContain('data-tags="travel,tech"');

			// Home page sees every tag via $tags.
			let home = await readFile(join(out, 'index.html'), 'utf8');
			// Each tag appears as a <li data-tag="…">.
			for (let tag of ['home', 'meta', 'food', 'travel', 'tech']) {
				expect(home).toContain(`data-tag="${tag}"`);
			}

			// The 'travel' tag lists both post-a and post-b via nested iteration.
			let travelMatch = home.match(/<li data-tag="travel">([\s\S]*?)<\/li>/);
			expect(travelMatch).not.toBeNull();
			let travelSection = travelMatch![1];
			expect(travelSection).toContain('data-path="/post-a/"');
			expect(travelSection).toContain('data-path="/post-b/"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('build({ only })', () => {
	test('rewrites only the target page and preserves siblings', async () => {
		let root = await copyFixture('site-sections');
		try {
			// Full build populates public/ with every page.
			await build({ cwd: root });
			let out = join(root, 'public');
			let { stat, writeFile } = await import('node:fs/promises');

			// Pick a content file whose layout embeds $page.content (blog/single.hbs
			// does; blog/index.hbs renders only $section and doesn't reference it).
			let targetRel = 'blog/post-1/index.html';
			let siblingRel = 'blog/post-2/index.html';

			let targetBefore = await readFile(join(out, targetRel), 'utf8');
			let siblingBefore = await readFile(join(out, siblingRel), 'utf8');
			let siblingMtimeBefore = (await stat(join(out, siblingRel))).mtimeMs;

			// Edit the target content file so its rendered HTML genuinely changes.
			let contentFile = join(root, 'content', 'blog', 'post-1.html');
			let src = await readFile(contentFile, 'utf8');
			await writeFile(contentFile, src + '\n<p data-bongo-test>narrow</p>\n');

			// Wait a tick so mtime resolution doesn't lie about "same second" writes.
			await new Promise(r => setTimeout(r, 20));

			// Narrow rebuild.
			await build({ cwd: root }, { only: 'blog/post-1.html' });

			let targetAfter = await readFile(join(out, targetRel), 'utf8');
			let siblingAfter = await readFile(join(out, siblingRel), 'utf8');
			let siblingMtimeAfter = (await stat(join(out, siblingRel))).mtimeMs;

			expect(targetAfter).not.toBe(targetBefore);
			expect(targetAfter).toContain('data-bongo-test');
			expect(siblingAfter).toBe(siblingBefore);
			expect(siblingMtimeAfter).toBe(siblingMtimeBefore);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('promotes to full rebuild when target frontmatter changed', async () => {
		let root = await copyFixture('site-sections');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');
			let { stat, writeFile } = await import('node:fs/promises');

			let siblingRel = 'blog/post-2/index.html';
			let siblingMtimeBefore = (await stat(join(out, siblingRel))).mtimeMs;

			// Edit the target's FRONTMATTER (change title). A body-only edit
			// would stay narrow; changing `title` shifts what sibling
			// $pages/$section iterations would render, so the frontmatter-sig
			// diff should force a full rebuild.
			let contentFile = join(root, 'content', 'blog', 'post-1.html');
			let src = await readFile(contentFile, 'utf8');
			await writeFile(
				contentFile,
				src.replace(/title:\s*.*/i, 'title: Renamed Post One'),
			);

			await new Promise(r => setTimeout(r, 20));
			await build({ cwd: root }, { only: 'blog/post-1.html' });

			let siblingMtimeAfter = (await stat(join(out, siblingRel))).mtimeMs;
			// Promoted to full ⇒ every page re-rendered ⇒ sibling mtime changed.
			expect(siblingMtimeAfter).toBeGreaterThan(siblingMtimeBefore);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('unknown `only` paths produce no output and do not clobber public/', async () => {
		let root = await copyFixture('site-sections');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			let before = await readFile(join(out, 'index.html'), 'utf8');

			// Nonexistent rel — nothing should render, nothing should be nuked.
			await build({ cwd: root }, { only: 'content-that-does-not-exist.md' });

			let after = await readFile(join(out, 'index.html'), 'utf8');
			expect(after).toBe(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
