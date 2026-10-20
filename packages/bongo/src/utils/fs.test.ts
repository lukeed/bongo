import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import * as fs from './fs';

function sandbox(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), 'bongo-fs-')));
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
	let start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error('timed out');
		await new Promise(r => setTimeout(r, 20));
	}
}

describe('copy', () => {
	test('copies without reporting a change to the source, so dev does not rebuild itself', async () => {
		let dir = sandbox();
		let out = sandbox();
		let bytes = Buffer.alloc(200_000, 7);
		writeFileSync(join(dir, 'photo.jpg'), bytes);
		let seen: string[] = [];
		let stop = await fs.watch([dir], file => { seen.push(file); });
		try {
			await new Promise(r => setTimeout(r, 500));
			seen.length = 0;
			await fs.copy(join(dir, 'photo.jpg'), join(out, 'nested/photo.jpg'));
			await new Promise(r => setTimeout(r, 300));
			expect(readFileSync(join(out, 'nested/photo.jpg')).equals(bytes)).toBe(true);
			expect(seen).toEqual([]);
		} finally {
			stop();
		}
	});
});

describe('isFile', () => {
	test('is true for a file or a link to one, and false for a folder or a missing path', () => {
		let dir = sandbox();
		writeFileSync(join(dir, 'a.css'), '');
		symlinkSync(join(dir, 'a.css'), join(dir, 'link.css'));
		mkdirSync(join(dir, 'sub'));
		expect(fs.isFile(join(dir, 'a.css'))).toBe(true);
		expect(fs.isFile(join(dir, 'link.css'))).toBe(true);
		expect(fs.isFile(join(dir, 'sub'))).toBe(false);
		expect(fs.isFile(join(dir, 'gone.css'))).toBe(false);
	});
});

describe('empty', () => {
	function project(): { root: string; out: string; keep: string[] } {
		let root = sandbox();
		let keep = ['assets', 'content'].map(name => join(root, name));
		for (let dir of keep) {
			mkdirSync(dir);
			writeFileSync(join(dir, 'source.txt'), 'keep me');
		}
		return { root, out: join(root, 'public'), keep };
	}

	test('deletes what is inside the folder, keeps the folder, and never follows a symlink out of it', async () => {
		let { root, out, keep } = project();
		let outside = sandbox();
		writeFileSync(join(outside, 'precious.txt'), 'x');
		mkdirSync(join(out, 'blog/post'), { recursive: true });
		writeFileSync(join(out, 'index.html'), 'x');
		writeFileSync(join(out, 'blog/post/index.html'), 'x');
		symlinkSync(outside, join(out, 'link'));
		symlinkSync(outside, join(out, 'blog/link'));
		symlinkSync(join(outside, 'precious.txt'), join(out, 'blog/post/file'));

		await fs.empty(out, root, keep);
		expect(readdirSync(out)).toEqual([]);
		expect(readdirSync(outside)).toEqual(['precious.txt']);
		expect(readdirSync(join(root, 'content'))).toEqual(['source.txt']);
	});

	test('does nothing for a folder that does not exist yet', async () => {
		let { root, out, keep } = project();
		await fs.empty(out, root, keep);
		expect(existsSync(out)).toBe(false);
	});

	test('tolerates another bongo emptying the folder at the same time', async () => {
		let { root, out, keep } = project();
		for (let i = 0; i < 50; i++) {
			mkdirSync(join(out, `${i}/a/b`), { recursive: true });
			writeFileSync(join(out, `${i}/a/b/index.html`), 'x');
		}
		await Promise.all([fs.empty(out, root, keep), fs.empty(out, root, keep), fs.empty(out, root, keep)]);
		expect(readdirSync(out)).toEqual([]);
	});

	test('refuses the project root, a source folder, or a symlink out of the project, and deletes nothing', async () => {
		let { root, out, keep } = project();
		let fail = (dir: string, reason: string) => expect(fs.empty(dir, root, keep)).rejects.toThrow(`Refusing to empty the output folder "${dir}": ${reason}`);
		await fail(root, 'it is the project root');
		await fail(join(root, 'content'), 'it is content/');

		symlinkSync(join(root, 'content'), out);
		await fail(out, 'it is content/');

		let elsewhere = sandbox();
		writeFileSync(join(elsewhere, 'precious.txt'), 'x');
		let other = join(root, 'other');
		symlinkSync(elsewhere, other);
		await fail(other, 'it is outside the project');

		expect(readdirSync(join(root, 'content'))).toEqual(['source.txt']);
		expect(readdirSync(elsewhere)).toEqual(['precious.txt']);
	});
});

describe('reuse', () => {
	function project(): { root: string; out: string; keep: string[] } {
		let root = sandbox();
		let keep = ['assets', 'content'].map(name => join(root, name));
		for (let dir of keep) mkdirSync(dir);
		return { root, out: join(root, 'public'), keep };
	}

	function put(file: string, text: string): void {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	}

	async function rewrite(old: fs.Reuse, file: string, text: string): Promise<void> {
		await old.fit(file);
		await fs.write(file, text);
	}

	test('writes over the files it keeps, deletes each symlink but never its target, and sweeps each file that no write claimed', async () => {
		let { root, out, keep } = project();
		let outside = sandbox();
		writeFileSync(join(outside, 'precious.txt'), 'x');
		put(join(out, 'index.html'), 'old');
		put(join(out, 'blog/post/index.html'), 'old');
		put(join(out, 'gone/stale.html'), 'old');
		symlinkSync(outside, join(out, 'link'));
		symlinkSync(join(outside, 'precious.txt'), join(out, 'blog/file'));
		let inode = statSync(join(out, 'index.html')).ino;

		let old = await fs.reuse(out, root, keep);
		expect(readdirSync(out).sort()).toEqual(['blog', 'gone', 'index.html']);
		await rewrite(old, join(out, 'index.html'), 'new');
		await rewrite(old, join(out, 'blog/post/index.html'), 'new');
		await old.sweep();

		expect(readdirSync(out).sort()).toEqual(['blog', 'index.html']);
		expect(readdirSync(join(out, 'blog'))).toEqual(['post']);
		expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('new');
		expect(statSync(join(out, 'index.html')).ino).toBe(inode);
		expect(readdirSync(outside)).toEqual(['precious.txt']);
	});

	test('makes room for a folder where a file was, and for a file where a folder was', async () => {
		let { root, out, keep } = project();
		put(join(out, 'feed'), 'old');
		put(join(out, 'about/index.html'), 'old');
		let old = await fs.reuse(out, root, keep);
		await rewrite(old, join(out, 'feed/index.html'), 'new');
		await rewrite(old, join(out, 'about'), 'new');
		await old.sweep();
		expect(readFileSync(join(out, 'feed/index.html'), 'utf8')).toBe('new');
		expect(readFileSync(join(out, 'about'), 'utf8')).toBe('new');
	});

	test('replaces a path that differs in case only, even when several writes need it at once, and the sweep keeps them', async () => {
		let { root, out, keep } = project();
		put(join(out, 'About/index.html'), 'old');
		put(join(out, 'About/team.html'), 'old');
		let old = await fs.reuse(out, root, keep);
		await Promise.all(['index.html', 'team.html', 'more/index.html'].map(name => rewrite(old, join(out, 'about', name), 'new')));
		await old.sweep();
		expect(readdirSync(out)).toEqual(['about']);
		expect(readdirSync(join(out, 'about')).sort()).toEqual(['index.html', 'more', 'team.html']);
		expect(readFileSync(join(out, 'about/team.html'), 'utf8')).toBe('new');
	});

	test('keeps a path that a write already claimed, and does nothing for a folder that does not exist yet', async () => {
		let { root, out, keep } = project();
		put(join(out, 'Docs/a.html'), 'old');
		let old = await fs.reuse(out, root, keep);
		await rewrite(old, join(out, 'Docs/a.html'), 'new');
		await old.fit(join(out, 'docs/b.html'));
		expect(readFileSync(join(out, 'Docs/a.html'), 'utf8')).toBe('new');

		let empty = project();
		let none = await fs.reuse(empty.out, empty.root, empty.keep);
		await none.sweep();
		expect(existsSync(empty.out)).toBe(false);
	});

	test('refuses an unsafe folder, as empty does, and deletes nothing', async () => {
		let { root, keep } = project();
		writeFileSync(join(root, 'content/source.txt'), 'keep me');
		await expect(fs.reuse(join(root, 'content'), root, keep)).rejects.toThrow(`Refusing to empty the output folder "${join(root, 'content')}": it is content/`);
		expect(readdirSync(join(root, 'content'))).toEqual(['source.txt']);
	});
});

describe('unsafe', () => {
	test('names why a folder may not be emptied, after resolving symlinks', () => {
		let root = '/site';
		let keep = ['/site/assets', '/site/content', '/site/data'];
		expect(fs.unsafe('/site/public', root, keep)).toBeUndefined();
		expect(fs.unsafe('/site/dist/public', root, keep)).toBeUndefined();
		expect(fs.unsafe('/', root, keep)).toBe('it is the file system root');
		expect(fs.unsafe('/site', root, keep)).toBe('it is the project root');
		expect(fs.unsafe('/site/', root, keep)).toBe('it is the project root');
		expect(fs.unsafe('/site/public/..', root, keep)).toBe('it is the project root');
		expect(fs.unsafe('/', '/', keep)).toBe('it is the file system root');
		expect(fs.unsafe('/other', root, keep)).toBe('it is outside the project');
		expect(fs.unsafe('/site/content', root, keep)).toBe('it is content/');
		expect(fs.unsafe('/site/content/out', root, keep)).toBe('it is inside content/');
		expect(fs.unsafe('/site/public', root, ['/site/public/content'])).toBe('it holds public/content/');

		let home = realpathSync(homedir());
		expect(fs.unsafe(home, join(home, 'site'), [])).toBe('it is the home folder');
		// as root, the home folder is /root, so the folder above it is the file system root
		let above = dirname(home);
		expect(fs.unsafe(above, join(home, 'site'), [])).toBe(above === parse(above).root ? 'it is the file system root' : 'it holds the home folder');
		expect(fs.unsafe(home, home, [])).toBe('it is the home folder');
	});

	test('reads a folder that does not exist yet through its nearest real parent', () => {
		let root = join(tmpdir(), `bongo-fs-missing-${Date.now()}`);
		expect(fs.unsafe(join(root, 'public'), root, [join(root, 'content')])).toBeUndefined();
	});
});

describe('prune', () => {
	test('deletes a file and the folders it leaves empty, up to the root', async () => {
		let root = sandbox();
		mkdirSync(join(root, 'a/b/c'), { recursive: true });
		writeFileSync(join(root, 'a/b/c/index.html'), 'x');
		writeFileSync(join(root, 'a/keep.txt'), 'x');
		await fs.prune(join(root, 'a/b/c/index.html'), root);
		expect(existsSync(join(root, 'a/b'))).toBe(false);
		expect(existsSync(join(root, 'a/keep.txt'))).toBe(true);
		await fs.prune(join(root, 'a/keep.txt'), root);
		expect(existsSync(join(root, 'a'))).toBe(false);
		expect(existsSync(root)).toBe(true);
	});
});

describe('list', () => {
	test('calls back for every file, with each folder\'s index files after the others', async () => {
		let root = sandbox();
		mkdirSync(join(root, 'blog'));
		for (let rel of ['blog/index.hbs', 'blog/index.xml.hbs', 'blog/post.md', 'index.md', 'about.md']) {
			writeFileSync(join(root, rel), 'x');
		}
		let seen: string[] = [];
		await fs.list(root, (_, rel) => { seen.push(rel); });
		expect(seen.toSorted()).toEqual(['about.md', 'blog/index.hbs', 'blog/index.xml.hbs', 'blog/post.md', 'index.md']);
		expect(seen.indexOf('blog/post.md')).toBeLessThan(seen.indexOf('blog/index.hbs'));
		expect(seen.indexOf('blog/post.md')).toBeLessThan(seen.indexOf('blog/index.xml.hbs'));
		expect(seen.at(-1)).toBe('index.md');
	});
});

describe('watch', () => {
	test('watches only the folder itself when not recursive', async () => {
		let dir = sandbox();
		mkdirSync(join(dir, 'sub'));
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); }, { recursive: false });
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(join(dir, 'sub/deep.css'), 'x');
			writeFileSync(join(dir, 'top.css'), 'x');
			await until(() => seen.has(join(dir, 'top.css')));
			await new Promise(r => setTimeout(r, 150));
			expect(seen.has(join(dir, 'sub/deep.css'))).toBe(false);
		} finally {
			stop();
		}
	});

	test('reports every file when several change at once', async () => {
		let dir = sandbox();
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); });
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(join(dir, 'a.css'), 'a');
			writeFileSync(join(dir, 'b.css'), 'b');
			await until(() => seen.has(join(dir, 'a.css')) && seen.has(join(dir, 'b.css')));
		} finally {
			stop();
		}
	});

	test('re-runs for a file that changes while its callback is still running', async () => {
		let dir = sandbox();
		let file = join(dir, 'a.css');
		let contents: string[] = [];
		let stop = await fs.watch([dir], async changed => {
			if (changed !== file) return;
			contents.push(readFileSync(file, 'utf8'));
			await new Promise(r => setTimeout(r, 250));
		});
		try {
			await new Promise(r => setTimeout(r, 100));
			writeFileSync(file, 'one');
			await until(() => contents.length === 1);
			writeFileSync(file, 'two');
			await until(() => contents.at(-1) === 'two');
		} finally {
			stop();
		}
	});

	test('starts on a folder that appears later, and reports the files it already holds', async () => {
		let root = sandbox();
		let dir = join(root, 'a/b');
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); });
		try {
			await new Promise(r => setTimeout(r, 100));
			mkdirSync(join(dir, 'deep'), { recursive: true });
			writeFileSync(join(dir, 'deep/first.css'), 'x');
			await until(() => seen.has(join(dir, 'deep/first.css')));
			writeFileSync(join(dir, 'second.css'), 'x');
			await until(() => seen.has(join(dir, 'second.css')));
		} finally {
			stop();
		}
	});

	test('follows a folder that goes away and comes back', async () => {
		let root = sandbox();
		let dir = join(root, 'assets');
		mkdirSync(dir);
		let seen = new Set<string>();
		let stop = await fs.watch([dir], file => { seen.add(file); });
		try {
			await new Promise(r => setTimeout(r, 100));
			rmSync(dir, { recursive: true });
			await new Promise(r => setTimeout(r, 200));
			mkdirSync(dir);
			await new Promise(r => setTimeout(r, 200));
			writeFileSync(join(dir, 'back.css'), 'x');
			await until(() => seen.has(join(dir, 'back.css')));
		} finally {
			stop();
		}
	});
});
