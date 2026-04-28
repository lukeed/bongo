import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { build } from '../../bongo/src/build';
import * as bundler from '../../bongo/src/utils/bundler';
import * as templates from '../../bongo/src/utils/templates';

const FIXTURES = join(import.meta.dirname, '../../bongo/test/fixtures');
// Absolute path to this plugin's source, used to inject a working import
// into each fixture's bongo.config.ts after the fixture is copied to /tmp.
const PLUGIN_SRC = join(import.meta.dirname, 'index');

beforeEach(() => {
	bundler.reset();
	templates.Layouts.clear();
	templates.Partials.clear();
});

async function copyFixture(name: string): Promise<string> {
	let target = join(tmpdir(), `bongo-feed-it-${randomBytes(6).toString('hex')}`);
	await mkdir(target, { recursive: true });
	await cp(join(FIXTURES, name), target, { recursive: true });

	// Rewrite bongo.config.ts to use an absolute import path so the bundled
	// config (loaded from /tmp) can find the plugin source.
	let configPath = join(target, 'bongo.config.ts');
	if (existsSync(configPath)) {
		let raw = await readFile(configPath, 'utf8');
		let rewritten = raw.replace(
			/from\s+['"][^'"]*plugin\.feed\/src\/index['"]/,
			`from '${PLUGIN_SRC}'`,
		);
		await writeFile(configPath, rewritten);
	}
	return target;
}

describe('integration: site-feed', () => {
	test('discovers feed.xml.hbs and emits Atom XML at the requested path', async () => {
		let root = await copyFixture('site-feed');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			// Feed file lives at the path declared in `feed.path` frontmatter.
			let feedPath = join(out, 'blog', 'feed.xml');
			expect(existsSync(feedPath)).toBe(true);

			let xml = await readFile(feedPath, 'utf8');
			expect(xml).toContain('<?xml version="1.0"');
			expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
			expect(xml).toContain('<title>Blog Feed</title>');
			// Both blog posts are in the feed.
			expect(xml).toContain('<title>Post A</title>');
			expect(xml).toContain('<title>Post B</title>');
			// Newest post (Post B, 2024-03-01) wins the feed-level <updated>.
			let updatedMatch = xml.match(/<feed[\s\S]*?<updated>([^<]+)<\/updated>/);
			expect(updatedMatch).not.toBeNull();
			expect(updatedMatch![1]).toBe('2024-03-01T00:00:00.000Z');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('does NOT write the feed file as a normal HTML page', async () => {
		let root = await copyFixture('site-feed');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			// If the feed file were treated as a normal page, build would write it
			// at `/blog/feed.xml/index.html`. It must not.
			expect(existsSync(join(out, 'blog', 'feed.xml', 'index.html'))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('feed source is excluded from $section iteration', async () => {
		let root = await copyFixture('site-feed');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			let blogIndex = await readFile(join(out, 'blog', 'index.html'), 'utf8');
			// Section iteration lists post-a and post-b, NOT feed.xml. (The alternate
			// `<link>` in <head> does reference the feed URL — we check the section
			// body explicitly via data-path entries.)
			expect(blogIndex).toContain('data-path="/blog/post-a/"');
			expect(blogIndex).toContain('data-path="/blog/post-b/"');
			expect(blogIndex).not.toContain('data-path="/blog/feed.xml"');
			expect(blogIndex).not.toContain('data-path="/blog/feed.xml/"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('attach prefix injects <link rel="alternate"> on matching pages only', async () => {
		let root = await copyFixture('site-feed');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			// Blog index matches /blog/ — must have the link.
			let blogIndex = await readFile(join(out, 'blog', 'index.html'), 'utf8');
			expect(blogIndex).toMatch(/<link rel="alternate"[^>]+type="application\/atom\+xml"/);
			expect(blogIndex).toContain('href="https://example.com/blog/feed.xml"');

			// Blog leaves match /blog/ too.
			let postA = await readFile(join(out, 'blog', 'post-a', 'index.html'), 'utf8');
			expect(postA).toMatch(/<link rel="alternate"/);

			// Home page is /, not /blog/ — must NOT have the link.
			let home = await readFile(join(out, 'index.html'), 'utf8');
			expect(home).not.toMatch(/<link rel="alternate"/);
			expect(home).toContain('data-feeds="0"');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('integration: site-feed-empty', () => {
	test('empty feed body produces a valid Atom feed without 1970 epoch', async () => {
		let root = await copyFixture('site-feed-empty');
		try {
			await build({ cwd: root });
			let out = join(root, 'public');

			let feedPath = join(out, 'feed.xml');
			expect(existsSync(feedPath)).toBe(true);

			let xml = await readFile(feedPath, 'utf8');
			expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
			// No entries.
			expect(xml).not.toContain('<entry>');
			// Feed-level <updated> is NOT 1970-01-01.
			expect(xml).not.toContain('1970-01-01');
			// And it IS a recent ISO timestamp.
			let updatedMatch = xml.match(/<updated>([^<]+)<\/updated>/);
			expect(updatedMatch).not.toBeNull();
			let when = new Date(updatedMatch![1]).getTime();
			expect(Math.abs(Date.now() - when)).toBeLessThan(60_000);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
