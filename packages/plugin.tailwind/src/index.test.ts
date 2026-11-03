import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { build } from '../../bongo/src/build';

// Inside this package, so the config resolves the plugin, and the stylesheets resolve tailwindcss, as in a project.
async function site(files: Record<string, string>): Promise<string> {
	let parent = join(import.meta.dirname, '../node_modules');
	await mkdir(parent, { recursive: true });
	let root = await mkdtemp(join(parent, '.fixture-'));
	let all: Record<string, string> = {
		'bongo.config.ts': `import { tailwind } from ${JSON.stringify(join(import.meta.dirname, 'index.ts'))};\nexport default { $site: { url: 'https://example.com/', title: 'T', lang: 'en' }, plugins: [tailwind()] };`,
		'layouts/html.hbs': '<html><bongo:style src="app.css" />{{{ $page.content }}}</html>',
		'assets/app.css': '@import "tailwindcss";',
		...files,
	};
	for (let [rel, text] of Object.entries(all)) {
		await mkdir(join(root, rel, '..'), { recursive: true });
		await writeFile(join(root, rel), text);
	}
	return root;
}

async function css(root: string, prefix = 'app.'): Promise<string> {
	let name = (await readdir(join(root, 'public'))).find(file => file.startsWith(prefix) && file.endsWith('.css'));
	if (!name) throw new Error(`no ${prefix}*.css`);
	return readFile(join(root, 'public', name), 'utf8');
}

describe('tailwind()', () => {
	test('builds the utilities of the classes that pages render, and not the words of their text', async () => {
		let root = await site({
			'content/index.hbs': `{{#var on = true}}<p class="flex {{ on ? 'text-red-500' : 'text-blue-500' }}">grid italic</p>`,
		});
		try {
			await build({ cwd: root });
			let out = await css(root);
			expect(out).toContain('.flex');
			expect(out).toContain('.text-red-500');
			expect(out).not.toContain('.text-blue-500');
			expect(out).not.toContain('.grid');
			expect(out).not.toContain('.italic');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('adds the classes of the scripts next to the stylesheet, and of each @source', async () => {
		let root = await site({
			'assets/app.css': '@import "tailwindcss";\n@source "../extra";',
			'assets/menu.ts': `document.body.classList.add('hidden');`,
			'extra/notes.txt': 'underline',
			'content/index.html': '<p>text</p>',
		});
		try {
			await build({ cwd: root });
			let out = await css(root);
			expect(out).toContain('.hidden');
			expect(out).toContain('.underline');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('keeps each url() of an inlined stylesheet working', async () => {
		let root = await site({
			'assets/app.css': '@import "tailwindcss";\n@import "./fonts/face.css";',
			'assets/fonts/face.css': '@font-face { font-family: F; src: url("./f.woff2") format("woff2"); }',
			'assets/fonts/f.woff2': 'font',
			'content/index.html': '<p class="flex">x</p>',
		});
		try {
			await build({ cwd: root });
			expect(await css(root)).toMatch(/url\("?\/f\.[a-f0-9]{8}\.woff2"?\)/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('builds a CSS module that only applies utilities while a page renders, as $assets.classes() needs it', async () => {
		let root = await site({
			'layouts/html.hbs': `{{#var css = await $assets.classes('button.module.css')}}<html><bongo:style src="button.module.css" /><button class="{{ css.btn }}">{{{ $page.content }}}</button></html>`,
			'assets/button.module.css': '@reference "tailwindcss";\n.btn { @apply flex; }',
			'content/index.html': '<p>x</p>',
		});
		try {
			await build({ cwd: root });
			let page = await readFile(join(root, 'public/index.html'), 'utf8');
			let name = /<button class="([^"]+)"/.exec(page)?.[1];
			expect(name).toBeTruthy();
			expect(await css(root, 'button.')).toMatch(new RegExp(`\\.${name}\\s*\\{\\s*display: flex`));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('leaves a stylesheet without Tailwind as it is', async () => {
		let root = await site({
			'layouts/html.hbs': '<html><bongo:style src="plain.css" />{{{ $page.content }}}</html>',
			'assets/plain.css': '.flex { color: red }',
			'content/index.html': '<p class="flex">x</p>',
		});
		try {
			await build({ cwd: root });
			expect(await css(root, 'plain.')).toBe('.flex {\n  color: red;\n}\n');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('a class that a new page renders reaches the stylesheet in the next build', async () => {
		let root = await site({ 'content/index.html': '<p class="flex">x</p>' });
		try {
			await build({ cwd: root });
			expect(await css(root)).not.toContain('.grid');
			await writeFile(join(root, 'content/more.html'), '<p class="grid">y</p>');
			await build({ cwd: root });
			expect(await css(root)).toContain('.grid');
			expect(await css(root)).toContain('.flex');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
