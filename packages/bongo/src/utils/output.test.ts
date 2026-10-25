import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalize } from './argv';
import * as output from './output';

import type { Argv } from 'bongo';

async function project(): Promise<Required<Argv>> {
	let argv: Argv = { cwd: await mkdtemp(join(tmpdir(), 'bongo-output-')) };
	normalize(argv);
	return argv;
}

describe('memory', () => {
	test('keeps written files in memory and never touches the folder', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		try {
			let file = join(argv.dest, 'blog/post/index.html');
			await sink.write(file, '<p>post</p>');
			expect(String(await sink.read(file))).toBe('<p>post</p>');
			expect(sink.get(file)).toMatchObject({ data: Buffer.from('<p>post</p>') });
			expect(existsSync(argv.dest)).toBe(false);

			await sink.remove(file);
			expect(sink.get(file)).toBeUndefined();
			await expect(sink.read(file)).rejects.toThrow('No ');
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});

	test('a copy points at its source, so a read always gets the current bytes', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		try {
			let source = join(argv.cwd, 'photo.png');
			await writeFile(source, 'one');
			let file = join(argv.dest, 'photo.png');
			await sink.copy(source, file);
			expect(sink.get(file)).toEqual({ file: source });
			await writeFile(source, 'two');
			expect(String(await sink.read(file))).toBe('two');
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});

	test('each write gets a new version, and clear forgets every file', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		let file = join(argv.dest, 'index.html');
		await sink.write(file, 'a');
		let first = sink.get(file);
		await sink.write(file, 'b');
		let second = sink.get(file);
		expect(first && 'version' in first && second && 'version' in second && second.version > first.version).toBe(true);
		await sink.clear();
		expect(sink.get(file)).toBeUndefined();
		await rm(argv.cwd, { recursive: true, force: true });
	});

	test('a mirror gets every change on disk, and clear empties the folder', async () => {
		let argv = await project();
		await mkdir(join(argv.dest, 'old'), { recursive: true });
		await writeFile(join(argv.dest, 'old/stale.html'), 'old');
		let sink = output.memory(argv.dest);
		try {
			await sink.mirror(output.disk(argv));
			expect(await readdir(argv.dest)).toEqual([]);

			let file = join(argv.dest, 'docs/index.html');
			await sink.write(file, 'docs');
			expect(await readFile(file, 'utf8')).toBe('docs');

			let source = join(argv.cwd, 'a.txt');
			await writeFile(source, 'copied');
			await sink.copy(source, join(argv.dest, 'a.txt'));
			expect(await readFile(join(argv.dest, 'a.txt'), 'utf8')).toBe('copied');

			await sink.remove(file);
			expect(existsSync(join(argv.dest, 'docs'))).toBe(false);
			expect(String(await sink.read(join(argv.dest, 'a.txt')))).toBe('copied');
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});

	test('a new mirror is emptied, then gets every file in memory at its own path; one that refuses leaves the last in place', async () => {
		let argv = await project();
		let other = { ...argv, dest: join(argv.cwd, 'web/out') };
		let sink = output.memory(argv.dest);
		try {
			let source = join(argv.cwd, 'a.txt');
			await writeFile(source, 'copied');
			await sink.write(join(argv.dest, 'index.html'), 'home');
			await sink.copy(source, join(argv.dest, 'a.txt'));
			await sink.defer(join(argv.dest, 'og/card.png'), async () => Buffer.from('png'));
			await sink.mirror(output.disk(argv));
			await mkdir(other.dest, { recursive: true });
			await writeFile(join(other.dest, 'stray.txt'), 'x');
			await sink.mirror(output.disk(other));
			expect((await readdir(other.dest, { recursive: true })).sort()).toEqual(['a.txt', 'index.html', 'og', 'og/card.png']);
			expect(await readFile(join(other.dest, 'og/card.png'), 'utf8')).toBe('png');

			await sink.write(join(argv.dest, 'index.html'), 'edited');
			expect(await readFile(join(other.dest, 'index.html'), 'utf8')).toBe('edited');
			expect(await readFile(join(argv.dest, 'index.html'), 'utf8')).toBe('home');

			await expect(sink.mirror(output.disk({ ...argv, dest: argv.content }))).rejects.toThrow('it is content/');
			await sink.write(join(argv.dest, 'b.html'), 'b');
			expect(await readFile(join(other.dest, 'b.html'), 'utf8')).toBe('b');
			expect(existsSync(join(argv.content, 'b.html'))).toBe(false);
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});
});

describe('defer', () => {
	test('memory makes a deferred file on its first read, once, and keeps it', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		let made = 0;
		let file = join(argv.dest, 'og/card.png');
		await sink.defer(file, async () => (made++, Buffer.from('png')));
		expect(made).toBe(0);
		let entry = sink.get(file);
		expect(entry && 'make' in entry).toBe(true);
		expect(String(await sink.read(file))).toBe('png');
		expect(String(await sink.read(file))).toBe('png');
		expect(made).toBe(1);
		expect(sink.get(file)).toMatchObject({ data: Buffer.from('png') });
		expect(existsSync(argv.dest)).toBe(false);
		await rm(argv.cwd, { recursive: true, force: true });
	});

	test('memory tries a deferred file again after its maker fails', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		let tries = 0;
		let file = join(argv.dest, 'og/card.png');
		await sink.defer(file, async () => {
			if (++tries === 1) throw new Error('busy');
			return Buffer.from('png');
		});
		await expect(sink.read(file)).rejects.toThrow('busy');
		expect(String(await sink.read(file))).toBe('png');
		await rm(argv.cwd, { recursive: true, force: true });
	});

	test('a disk sink, and the mirror of a memory sink, make the file at once', async () => {
		let argv = await project();
		let sink = output.memory(argv.dest);
		try {
			await sink.mirror(output.disk(argv));
			let file = join(argv.dest, 'og/card.png');
			await sink.defer(file, async () => Buffer.from('png'));
			expect(await readFile(file, 'utf8')).toBe('png');
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});
});

describe('memory minify', () => {
	test('minifies the HTML it holds with the minify CLI, through temp files', async () => {
		let argv = await project();
		let bin = join(argv.cwd, 'bin');
		await mkdir(bin);
		await writeFile(join(bin, 'minify'), '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nshift 2\nfor f in "$@"; do tr -d " " < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done\n', { mode: 0o755 });
		let path = process.env.PATH;
		process.env.PATH = bin + ':' + path;
		let sink = output.memory(argv.dest);
		try {
			let a = join(argv.dest, 'index.html'), b = join(argv.dest, 'docs/index.html');
			await sink.write(a, '<p> a b </p>');
			await sink.write(b, '<p> c </p>');
			expect(await sink.minify([a, b])).toBe(true);
			expect(String(await sink.read(a))).toBe('<p>ab</p>');
			expect(String(await sink.read(b))).toBe('<p>c</p>');
			expect(existsSync(argv.dest)).toBe(false);
		} finally {
			process.env.PATH = path;
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});
});

describe('disk', () => {
	test('is one sink for each output folder, and removing a file prunes its empty folders', async () => {
		let argv = await project();
		let sink = output.disk(argv);
		try {
			expect(output.disk({ ...argv })).toBe(sink);
			let file = join(argv.dest, 'a/b/index.html');
			await sink.write(file, 'x');
			expect(await readFile(file, 'utf8')).toBe('x');
			await sink.remove(file);
			expect(existsSync(join(argv.dest, 'a'))).toBe(false);
		} finally {
			await rm(argv.cwd, { recursive: true, force: true });
		}
	});

	test('refuses to empty a folder outside the project', async () => {
		let argv = await project();
		let sink = output.disk({ ...argv, dest: tmpdir() });
		await expect(sink.clear()).rejects.toThrow('Refusing to empty the output folder');
		await rm(argv.cwd, { recursive: true, force: true });
	});
});
