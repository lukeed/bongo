import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WORDS = 'build page layout partial asset bundle stream render template section header footer token cache module script style output input folder path route index archive feed theme color margin border grid column river stone quiet bright early late small large fast slow plain simple robust clear steady prompt silent hollow amber silver copper cobalt linen maple cedar harbor meadow summit valley canyon delta ridge signal vector buffer cursor kernel thread socket packet header record field value entry table query filter merge split shift scale frame layer canvas glyph pixel shader sample window panel drawer modal badge chip toast'.split(' ');
const LANGS = ['ts', 'css', 'bash', 'json'];
const PER_SECTION = 100;

type Random = () => number;

// mulberry32, so every run writes the same bytes
function random(seed: number): Random {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function int(rand: Random, min: number, max: number): number {
	return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(rand: Random, list: T[]): T {
	return list[Math.floor(rand() * list.length)];
}

function words(rand: Random, count: number): string[] {
	return Array.from({ length: count }, () => pick(rand, WORDS));
}

function title(rand: Random): string {
	return words(rand, int(rand, 2, 5)).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function sentence(rand: Random, link?: () => string): string {
	let list = words(rand, int(rand, 6, 16));
	let roll = link ? rand() : 1;
	let at = int(rand, 1, list.length - 1);
	if (roll < 0.15) list[at] = '`' + list[at] + '()`';
	else if (roll < 0.25) list[at] = '**' + list[at] + '**';
	else if (link && roll < 0.35) list[at] = `[${list[at]}](${link()})`;
	let text = list.join(' ');
	return text[0].toUpperCase() + text.slice(1) + '.';
}

function paragraph(rand: Random, link: () => string): string {
	return Array.from({ length: int(rand, 2, 6) }, () => sentence(rand, link)).join(' ');
}

function code(rand: Random, lang: string): string {
	let lines = Array.from({ length: int(rand, 3, 12) }, () => {
		let [a, b, c] = words(rand, 3);
		if (lang === 'css') return `.${a}-${b} { ${c}: ${int(rand, 0, 64)}px; }`;
		if (lang === 'bash') return `bongo ${a} --${b} ${c}/${int(rand, 1, 9)}`;
		if (lang === 'json') return `"${a}_${b}": { "${c}": ${int(rand, 0, 999)} },`;
		return `let ${a}_${b} = await ${c}(${int(rand, 0, 99)}, '${a}');`;
	});
	return '```' + lang + '\n' + lines.join('\n') + '\n```';
}

function body(rand: Random, link: () => string): string {
	let blocks = [paragraph(rand, link)];
	let count = int(rand, 2, 5);
	for (let i = 0; i < count; i++) {
		blocks.push('## ' + title(rand));
		let paragraphs = int(rand, 1, 3);
		for (let j = 0; j < paragraphs; j++) blocks.push(paragraph(rand, link));
		let roll = rand();
		if (roll < 0.35) blocks.push(code(rand, pick(rand, LANGS)));
		else if (roll < 0.55) blocks.push(Array.from({ length: int(rand, 2, 6) }, () => '- ' + sentence(rand, link)).join('\n'));
		else if (roll < 0.65) blocks.push('> ' + sentence(rand, link));
		else if (roll < 0.72) blocks.push(`| ${words(rand, 3).join(' | ')} |\n| --- | --- | --- |\n` + Array.from({ length: int(rand, 2, 5) }, () => `| ${words(rand, 3).join(' | ')} |`).join('\n'));
	}
	return blocks.join('\n\n') + '\n';
}

function date(rand: Random): string {
	return `20${int(rand, 18, 25)}-${String(int(rand, 1, 12)).padStart(2, '0')}-${String(int(rand, 1, 28)).padStart(2, '0')}`;
}

const SITEMAP = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{{#each $pages as page}}
	<url><loc>{{ page.url }}</loc></url>
{{/each}}
</urlset>
`;

/**
 * Empty `content/` of the site at `dir`, then write `pages` Markdown pages into it, 100 to a section, plus an index for each section, a home page, and a sitemap.
 * The same `pages` gives the same bytes on every call.
 * @example await content.write('bench/site', 10_000);
 */
export async function write(dir: string, pages: number): Promise<void> {
	let root = join(dir, 'content');
	let rand = random(56);
	let sections = Math.ceil(pages / PER_SECTION);
	let tags = Array.from({ length: 40 }, () => pick(rand, WORDS) + '-' + pick(rand, WORDS));
	let link = () => `/s${int(rand, 0, sections - 1)}/p${int(rand, 0, PER_SECTION - 1)}/`;

	await rm(root, { recursive: true, force: true });
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'index.md'), `---\ntitle: Home\nsummary: ${sentence(rand)}\n---\n\n${paragraph(rand, link)}\n`);
	await writeFile(join(root, 'sitemap.xml.hbs'), SITEMAP);

	for (let s = 0; s < sections; s++) {
		let folder = join(root, `s${s}`);
		await mkdir(folder);
		await writeFile(join(folder, 'index.md'), `---\ntitle: ${title(rand)}\nsummary: ${sentence(rand)}\n---\n\n${paragraph(rand, link)}\n`);
		let count = Math.min(PER_SECTION, pages - s * PER_SECTION);
		await Promise.all(Array.from({ length: count }, (_, p) => {
			let frontmatter = `---\ntitle: ${title(rand)}\nsummary: ${sentence(rand)}\ndate: ${date(rand)}\ntags: ${[...new Set([pick(rand, tags), pick(rand, tags)])].join(', ')}\n---\n\n`;
			return writeFile(join(folder, `p${p}.md`), frontmatter + body(rand, link));
		}));
	}
}
