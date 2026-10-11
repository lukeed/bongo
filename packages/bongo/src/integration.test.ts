import { describe, expect, test, beforeEach, spyOn } from 'bun:test';
import { mkdir, mkdtemp, cp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import sharp from 'sharp';

import { build } from './build';
import * as bundler from './utils/bundler';
import * as images from './utils/images';
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

async function site(files: Record<string, string>): Promise<string> {
	let root = join(tmpdir(), `bongo-it-${randomBytes(6).toString('hex')}`);
	let all: Record<string, string> = {
		'bongo.config.ts': `export default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' } };`,
		'layouts/html.hbs': '{{{ $page.content }}}',
		...files,
	};
	for (let [rel, text] of Object.entries(all)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), text);
	}
	return root;
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

describe('integration: --debug', () => {
	test('names each stage of the build', async () => {
		let root = await copyFixture('site-basic');
		let spy = spyOn(console, 'log').mockImplementation(() => {});
		try {
			await build({ cwd: root, debug: true });
			let stages = spy.mock.calls.filter(args => args[1] === '[stage]' && !String(args[2]).includes(': ')).map(args => args[2]);
			expect(stages).toEqual([
				'loading the config and data/',
				'compiling layouts and partials',
				'reading content/',
				'rendering pages',
				'bundling assets',
				'writing pages',
			]);
		} finally {
			spy.mockRestore();
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
	async function failure(root: string): Promise<Error> {
		try {
			await build({ cwd: root });
		} catch (err) {
			if (err instanceof Error) return err;
		}
		throw new Error('expected the build to fail');
	}

	test('surfaces bundler errors with a useful message', async () => {
		let root = await copyFixture('site-build-error');
		try {
			let err = await failure(root);
			expect(err.message).toMatch(/^Build failed: \[PARSE_ERROR\] .*Unexpected token \(assets\/broken\.ts:2:26\)$/);
			expect(err.message).not.toContain('\x1b');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('names the first error and counts the rest', async () => {
		let root = await copyFixture('site-build-error');
		try {
			await writeFile(join(root, 'assets/gone.css'), '.x { background: url(./gone.png); }');
			let layout = join(root, 'layouts/html.hbs');
			let html = await readFile(layout, 'utf8');
			await writeFile(layout, html.replace('<body>', '<body>\n<bongo:style src="gone.css"></bongo:style>'));

			let err = await failure(root);
			expect(err.message).toMatch(/^Build failed: Missing "\.\/gone\.png" referenced in \S+gone\.css \(assets\/gone\.css\), and 1 more error$/);
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

describe('integration: typed frontmatter', () => {
	test('pages see typed params, text title and summary, and tags from lists', async () => {
		let root = await site({
			'content/post.html': [
				'---',
				'title: 2024',
				'summary: true',
				'count: 3',
				'hidden: true',
				'tags: [a, 2, "c"]',
				'author:',
				'  name: Luke',
				'---',
				'<p>x</p>',
			].join('\n'),
			'content/legacy.html': '---\ntitle: Legacy\ntags: x, y\n---\n<p>y</p>',
			'layouts/html.hbs': [
				'<i data-title="{{ $page.title }}" data-title-type="{{ typeof $page.title }}" data-summary="{{ $page.summary }}"',
				' data-count="{{ typeof $page.params.count }}" data-hidden="{{ $page.params.hidden === true }}"',
				' data-tags="{{ $page.tags.join(\'|\') }}" data-author="{{ $page.params.author && $page.params.author.name }}"></i>',
			].join(''),
		});
		try {
			await build({ cwd: root });
			let post = await readFile(join(root, 'public/post/index.html'), 'utf8');
			expect(post).toBe('<i data-title="2024" data-title-type="string" data-summary="true" data-count="number" data-hidden="true" data-tags="a|2|c" data-author="Luke"></i>');
			let legacy = await readFile(join(root, 'public/legacy/index.html'), 'utf8');
			expect(legacy).toContain('data-tags="x|y"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a frontmatter error names the content file and line', async () => {
		let root = await site({ 'content/blog/bad.html': '---\ntitle: a\ntitle: b\n---\n<p>x</p>' });
		try {
			let file = join('content', 'blog', 'bad.html');
			await expect(build({ cwd: root })).rejects.toThrow(`${file}: Invalid frontmatter: duplicate key "title" at line 3`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: $data', () => {
	test('layouts, content, and partials read data/ files as $data', async () => {
		let root = await site({
			'data/oss/history.json': '[["2015-02", 12], ["2015-03", 30]]',
			'data/site.yaml': 'name: bongo\nlinks:\n  - label: GitHub\n    href: https://github.com',
			'partials/links.hbs': '{{#each $data.site.links as link}}<a href="{{ link.href }}">{{ link.label }}</a>{{/each}}',
			'content/index.hbs': '---\ntitle: Home\n---\n<p>{{ $data.site.name }}: {{ $data.oss.history.length }} months</p>',
			'layouts/html.hbs': '<main>{{{ $page.content }}}</main><footer>{{#partial src="links" }}</footer><i>{{ $data.oss.history[1][1] }}</i>',
		});
		try {
			await build({ cwd: root });
			let html = await readFile(join(root, 'public/index.html'), 'utf8');
			expect(html).toBe('<main>\n<p>bongo: 2 months</p></main><footer><a href="https://github.com">GitHub</a></footer><i>30</i>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a site without data/ gets an empty $data', async () => {
		let root = await site({
			'content/index.html': '<p>x</p>',
			'layouts/html.hbs': '{{ Object.keys($data).length }}',
		});
		try {
			await build({ cwd: root });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toBe('0');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a broken data file fails the build and names the file', async () => {
		let root = await site({ 'data/bad.yaml': 'a: 1\na: 2', 'content/index.html': '<p>x</p>' });
		try {
			await expect(build({ cwd: root })).rejects.toThrow(`${join('data', 'bad.yaml')}: duplicate key "a" at line 2`);
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

describe('dev rebuilds', () => {
	let files = async (root: string) => (await readdir(join(root, 'public'))).sort();

	async function devSite(page: string): Promise<string> {
		return site({
			'assets/style.css': 'body { color: red }',
			'assets/extra.css': '.extra { color: blue }',
			'assets/main.ts': 'console.log("main");',
			'layouts/html.hbs': '<bongo:style src="style.css" />{{{ $page.content }}}',
			'content/index.html': page,
			'content/about.html': '<p>about</p>',
		});
	}

	test('a removed tag stops being built, and its file is deleted', async () => {
		let root = await devSite('<bongo:style src="extra.css" /><p>home</p>');
		try {
			await build({ cwd: root, dev: true });
			expect((await files(root)).filter(f => f.endsWith('.css'))).toEqual([expect.stringMatching(/^extra\./), expect.stringMatching(/^style\./)]);

			await writeFile(join(root, 'content/index.html'), '<p>home</p>');
			await build({ cwd: root, dev: true }, { only: 'index.html' });
			expect((await files(root)).filter(f => f.endsWith('.css'))).toEqual([expect.stringMatching(/^style\./)]);

			await build({ cwd: root, dev: true });
			expect((await files(root)).filter(f => f.endsWith('.css'))).toEqual([expect.stringMatching(/^style\./)]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a changed tag replaces its old output instead of adding to it', async () => {
		let root = await devSite('<bongo:script src="main.ts" /><p>home</p>');
		try {
			await build({ cwd: root, dev: true });
			let before = (await files(root)).filter(f => f.endsWith('.js'));
			expect(before).toHaveLength(1);

			await writeFile(join(root, 'content/index.html'), '<bongo:script src="main.ts" format="cjs" /><p>home</p>');
			await build({ cwd: root, dev: true }, { only: 'index.html' });
			let after = (await files(root)).filter(f => f.endsWith('.js'));
			expect(after).toHaveLength(1);
			expect(after).not.toEqual(before);
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toContain(`src="/${after[0]}"`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('keeps assets that other pages still use during a narrow rebuild', async () => {
		let root = await devSite('<p>home</p>');
		try {
			await writeFile(join(root, 'content/about.html'), '<bongo:style src="extra.css" /><p>about</p>');
			await build({ cwd: root, dev: true });
			await writeFile(join(root, 'content/index.html'), '<p>home, edited</p>');
			await build({ cwd: root, dev: true }, { only: 'index.html' });
			let css = (await files(root)).filter(f => f.endsWith('.css'));
			expect(css).toEqual([expect.stringMatching(/^extra\./), expect.stringMatching(/^style\./)]);
			expect(await readFile(join(root, 'public/about/index.html'), 'utf8')).toContain(`href="/${css[0]}"`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a fixed tag recovers from a failed build', async () => {
		let root = await devSite('<bongo:script src="main.ts" target="chrome60" /><p>home</p>');
		try {
			await expect(build({ cwd: root, dev: true })).rejects.toThrow(/Unknown browser query/);
			await writeFile(join(root, 'content/index.html'), '<bongo:script src="main.ts" target="chrome 60" /><p>home</p>');
			await build({ cwd: root, dev: true }, { only: 'index.html' });
			expect(await readFile(join(root, 'public/index.html'), 'utf8')).toContain('<p>home</p>');
			expect(await readFile(join(root, 'public/about/index.html'), 'utf8')).toContain('<p>about</p>');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-css-assets', () => {
	test('emits css url() files hashed under publicPath, for linked and inline styles', async () => {
		let root = await copyFixture('site-css-assets');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');
			let files = await readdir(out);
			let font = files.find(f => /^fixture\.[\w-]{8}\.woff2$/.test(f));
			let svg = files.filter(f => /^hero\.[\w-]{8}\.svg$/.test(f));
			expect(font).toBeDefined();
			expect(svg).toHaveLength(1);

			let html = await readFile(join(out, 'index.html'), 'utf8');
			let href = html.match(/<link rel="stylesheet" href="\/docs\/([^"]+)"\/>/)![1];
			let style = await readFile(join(out, href), 'utf8');
			expect(style).toContain(`url("/docs/${font}")`);
			expect(style).toContain(`url("/docs/${svg[0]}")`);
			expect(style).toContain('url("https://cdn.example.com/x.png")');
			expect(html).toContain(`url("/docs/${svg[0]}#icon")`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('fails the build when a url() file is missing', async () => {
		let root = await copyFixture('site-css-assets');
		try {
			await rm(join(root, 'assets/fonts/fixture.woff2'));
			await expect(build({ cwd: root })).rejects.toThrow(/^Build failed: Missing "\.\.\/fonts\/fixture\.woff2" referenced in \S+fonts\.css \(assets\/style\.css\)$/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('build({ minify })', () => {
	async function outputs(root: string) {
		let out = join(root, 'public');
		let files = await readdir(out);
		let css = files.find(f => /^style\.[\w-]+\.css$/.test(f))!;
		let js = files.find(f => /^main\.[\w-]+\.js$/.test(f))!;
		return {
			css: await readFile(join(out, css), 'utf8'),
			js: await readFile(join(out, js), 'utf8'),
			html: await readFile(join(out, 'index.html'), 'utf8'),
		};
	}

	async function withPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
		let prev = process.env.PATH;
		process.env.PATH = dir;
		try { return await run(); }
		finally { process.env.PATH = prev; }
	}

	test('minifies css and js, and skips html without the minify CLI', async () => {
		let root = await copyFixture('site-css-assets');
		let empty = await mkdtemp(join(tmpdir(), 'bongo-path-'));
		try {
			await build({ cwd: root });
			let plain = await outputs(root);
			bundler.reset();
			await withPath(empty, () => build({ cwd: root, minify: true }));
			let small = await outputs(root);

			expect(plain.css).toContain('\n  background');
			expect(small.css).not.toContain('\n');
			expect(small.css.length).toBeLessThan(plain.css.length);
			expect(small.js.length).toBeLessThan(plain.js.length);
			expect(small.html).toContain('<p>Fixture   page</p>');
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(empty, { recursive: true, force: true });
		}
	});

	test('minifies html in place with the minify CLI when it is on PATH', async () => {
		let root = await copyFixture('site-css-assets');
		let bin = await mkdtemp(join(tmpdir(), 'bongo-path-'));
		let calls = join(bin, 'calls.log');
		await writeFile(join(bin, 'minify'), [
			'#!/bin/sh',
			`echo "$@" >> "${calls}"`,
			'[ "$1" = "--version" ] && { echo "minify v0.0.0"; exit 0; }',
			'for f in "$@"; do case "$f" in -*) ;; *) /usr/bin/tr -s " " < "$f" > "$f.tmp" && /bin/mv "$f.tmp" "$f";; esac; done',
		].join('\n'), { mode: 0o755 });
		try {
			await withPath(bin, () => build({ cwd: root, minify: true }));
			let { html } = await outputs(root);
			expect(html).toContain('<p>Fixture page</p>');
			let log = await readFile(calls, 'utf8');
			let args = log.trim().split('\n').at(-1)!.split(' ');
			expect(args.slice(0, 2)).toEqual(['-q', '-i']);
			expect(args.slice(2).every(f => f.endsWith('.html'))).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(bin, { recursive: true, force: true });
		}
	});
});

describe('integration: site-asset', () => {
	async function read(root: string) {
		let out = join(root, 'public');
		let files = await readdir(out);
		let html = await readFile(join(out, 'index.html'), 'utf8');
		let sheet = html.match(/<link rel="stylesheet" href="\/docs\/([^"]+)"\/>/)![1];
		return { files, html, css: await readFile(join(out, sheet), 'utf8') };
	}

	test('preloads and plain urls point at the same hashed copies as the css', async () => {
		let root = await copyFixture('site-asset');
		try {
			await build({ cwd: root });
			let { files, html, css } = await read(root);
			let fonts = files.filter(f => /^fixture\.[\w-]{8}\.woff2$/.test(f));
			let logos = files.filter(f => /^logo\.[\w-]{8}\.png$/.test(f));
			expect(fonts).toHaveLength(1);
			expect(logos).toHaveLength(1);

			let font = `/docs/${fonts[0]}`;
			let logo = `/docs/${logos[0]}`;
			expect(css).toContain(`url("${font}")`);
			expect(css).toContain(`url("${logo}")`);
			expect(html).toContain(`<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin/>`);
			expect(html).toContain(`<link rel="preload" href="${logo}" as="image" type="image/png" media="(width >= 600px)" fetchpriority="high"/>`);
			expect(html).toContain(`<link rel="icon" href="${logo}"/>`);
			expect(html).toContain(`<img class="content" src="${logo}" alt=""/>`);
			expect(html).toContain(`<img class="partial" src="${logo}" alt=""/>`);
			expect(html).not.toContain('bongo:asset');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('dev builds emit the same asset links', async () => {
		let root = await copyFixture('site-asset');
		try {
			await build({ cwd: root });
			let prod = (await read(root)).html;
			bundler.reset();
			await build({ cwd: root, dev: true });
			let dev = (await read(root)).html;
			let links = (html: string) => html.match(/<link rel="(preload|icon)"[^>]*>|<img [^>]*>/g);
			expect(links(dev)).toEqual(links(prod));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a missing file fails with the tag and where it was rendered', async () => {
		let root = await copyFixture('site-asset');
		try {
			await rm(join(root, 'assets/fonts/fixture.woff2'));
			let run = build({ cwd: root });
			await expect(run).rejects.toThrow('Missing "assets/fonts/fixture.woff2" for <bongo:asset preload src="fonts/fixture.woff2" />, rendering content/index.html → layouts/html.hbs');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-image', () => {
	async function read(root: string, page = 'index.html') {
		let out = join(root, 'public');
		let files = await readdir(out);
		let html = await readFile(join(out, page), 'utf8');
		let find = (name: string, width: number, ext: string) => files.find(f => new RegExp(`^${name}-${width}\\.[a-f0-9]{8}\\.${ext}$`).test(f))!;
		let set = (name: string, widths: number[], ext: string) => widths.map(w => `/docs/${find(name, w, ext)} ${w}w`).join(', ');
		return { files, html, find, set };
	}

	test('<bongo:image> writes resized copies and a <picture> with intrinsic dimensions', async () => {
		let root = await copyFixture('site-image');
		try {
			await build({ cwd: root });
			let { files, html, find, set } = await read(root);

			let widths = [640, 1280, 1920];
			for (let ext of ['avif', 'webp']) {
				for (let w of widths) expect(find('hero', w, ext)).toBeDefined();
			}
			expect(files.filter(f => f.startsWith('hero-'))).toHaveLength(6);

			let logo = files.find(f => /^logo\.[a-f0-9]{8}\.svg$/.test(f));
			let spin = files.find(f => /^spin\.[a-f0-9]{8}\.gif$/.test(f));
			expect(html).toContain(`<picture><source type="image/avif" srcset="${set('hero', widths, 'avif')}" sizes="100vw"/><img src="/docs/${find('hero', 1920, 'webp')}" srcset="${set('hero', widths, 'webp')}" sizes="100vw" alt="Hero" fetchpriority="high" loading="eager" decoding="async" width="2400" height="1200"/></picture>`);
			expect(html).toContain(`<picture><img src="/docs/${logo}" alt="Logo" class="logo" loading="lazy" decoding="async" width="120" height="40"/></picture>`);
			expect(html).toContain(`<picture><img src="/docs/${spin}" alt="" loading="lazy" decoding="async" width="20" height="30"/></picture>`);
			expect(html).not.toContain('bongo');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('<bongo:image> in content reads files next to the page', async () => {
		let root = await copyFixture('site-image');
		try {
			await build({ cwd: root });
			let { html, find } = await read(root, 'blog/post/index.html');
			let photo = find('photo', 320, 'webp');
			expect(html).toContain(`<picture><img src="/docs/${photo}" srcset="/docs/${photo} 320w" sizes="auto, 100vw" alt="Element" loading="lazy" decoding="async" width="800" height="600"/></picture>`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('<img> in content gets a srcset in the fallback format, and its dimensions', async () => {
		let root = await copyFixture('site-image');
		try {
			await build({ cwd: root });
			let { files, html, find, set } = await read(root, 'blog/post/index.html');
			let diagram = files.find(f => /^diagram\.[a-f0-9]{8}\.svg$/.test(f));
			expect(files.filter(f => /^(photo|portrait)-.*\.avif$/.test(f))).toEqual([]);

			expect(html).toContain(`<figure><img src="/docs/${find('photo', 800, 'webp')}" srcset="${set('photo', [640, 800], 'webp')}" sizes="auto, 100vw" alt="A &quot;photo&quot;" class="shot" loading="lazy" decoding="async" width="800" height="600"/></figure>`);
			expect(html).toContain(`<img src="/docs/${find('portrait', 400, 'webp')}" srcset="${set('portrait', [400], 'webp')}" sizes="auto, 100vw" alt="Portrait" loading="lazy" decoding="async" width="400" height="600"/>`);
			expect(html).toContain(`<img src="/docs/${diagram}" alt="Diagram" loading="lazy" decoding="async" width="300" height="150"/>`);
			for (let kept of [
				'<img src="https://cdn.example.com/x.png" alt="">',
				'<img src="/blog/post/photo.png" alt="root">',
				'<img src="photo.png" srcset="photo.png 1x" alt="manual">',
				'<picture><img src="photo.png" alt="nested"></picture>',
				'<!-- <img src="gone.png"> -->',
			]) expect(html).toContain(kept);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('$images.content = false leaves content images as written', async () => {
		let root = await copyFixture('site-image');
		try {
			await writeFile(join(root, 'bongo.config.ts'), `export default { $site: { url: 'https://example.com/docs/' }, $images: { content: false } };`);
			await build({ cwd: root });
			let { html } = await read(root, 'blog/post/index.html');
			expect(html).toContain('<figure><img src="photo.png" alt="A &quot;photo&quot;" class="shot"/></figure>');
			expect(html).toContain('<img src="portrait.jpg" alt="Portrait">');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a missing content image fails with the tag and the content file', async () => {
		let root = await copyFixture('site-image');
		try {
			await rm(join(root, 'content/blog/post/portrait.jpg'));
			await expect(build({ cwd: root })).rejects.toThrow('Missing "content/blog/post/portrait.jpg" for <img src="portrait.jpg" alt="Portrait">, rendering content/blog/post.html');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('dev builds emit the same markup, and encode only what the server is asked for', async () => {
		let root = await copyFixture('site-image');
		try {
			let tags = /<picture>[\s\S]*?<\/picture>|<img [^>]*>/g;
			await build({ cwd: root });
			let prod = [(await read(root)).html.match(tags), (await read(root, 'blog/post/index.html')).html.match(tags)];

			bundler.reset();
			await rm(join(root, 'node_modules'), { recursive: true });
			await build({ cwd: root, dev: true });
			let { files, html } = await read(root);
			let post = await read(root, 'blog/post/index.html');
			expect([html.match(tags), post.html.match(tags)]).toEqual(prod);

			expect(files.filter(f => /\.(avif|webp)$/.test(f))).toEqual([]);
			expect(files.filter(f => /\.(svg|gif)$/.test(f))).toHaveLength(3);

			let name = html.match(/\/docs\/(hero-640\.[a-f0-9]{8}\.avif) 640w/)![1];
			let body = await images.serve(name)!;
			expect((await sharp(body).metadata()).width).toBe(640);
			expect(await readdir(join(root, 'node_modules/.cache/bongo/images'))).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('rebuilds copy unchanged images from the cache', async () => {
		let root = await copyFixture('site-image');
		try {
			await build({ cwd: root });
			let { find } = await read(root);
			let name = find('hero', 640, 'avif');
			let cache = join(root, 'node_modules/.cache/bongo/images');
			let entry = (await readdir(cache)).find(f => f.startsWith(name.split('.')[1]))!;
			await writeFile(join(cache, entry), 'cached');

			bundler.reset();
			await build({ cwd: root });
			expect(await readFile(join(root, 'public', name), 'utf8')).toBe('cached');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a missing image fails with the tag and where it was rendered', async () => {
		let root = await copyFixture('site-image');
		try {
			await rm(join(root, 'assets/img/hero.jpg'));
			await expect(build({ cwd: root })).rejects.toThrow(/^Missing "assets\/img\/hero\.jpg" for <bongo:image src="img\/hero\.jpg" alt="Hero" sizes="100vw" fetchpriority="high" \/>, rendering content\/[\w/.]+ → layouts\/html\.hbs$/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('without sharp, the build names the image and how to install sharp', async () => {
		let root = await copyFixture('site-image');
		try {
			let preload = join(root, 'no-sharp.ts');
			let script = join(root, 'run.ts');
			await writeFile(preload, [
				`import { plugin } from 'bun';`,
				`plugin({ name: 'no-sharp', setup(b) { b.module('sharp', () => { throw new Error("Cannot find package 'sharp'"); }); } });`,
			].join('\n'));
			await writeFile(script, `import { build } from ${JSON.stringify(join(import.meta.dirname, 'build'))};\nawait build({ cwd: ${JSON.stringify(root)} });\n`);

			let proc = Bun.spawn(['bun', '--preload', preload, script], { stdout: 'pipe', stderr: 'pipe' });
			let [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
			expect(code).not.toBe(0);
			expect(stderr).toContain(`Processing "${join(root, 'assets/img/hero.jpg')}" needs the "sharp" package: bun add -d sharp`);
			expect(stderr).toContain('Build failed');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
