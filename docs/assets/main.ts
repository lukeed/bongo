import { navigate, on } from 'bongo/client';

type Entry = {
	title: string;
	path: string;
	group: string;
	summary: string;
	headings: [id: string, text: string][];
};

type Hit = {
	href: string;
	title: string;
	context: string;
	score: number;
};

let root = document.documentElement;
let index: Promise<Entry[]> | undefined;
let hits: Hit[] = [];
let active = 0;

function escape(text: string): string {
	return text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
}

function mark(text: string, words: string[]): string {
	let html = escape(text);
	for (let word of words) html = html.replace(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
	return html;
}

function score(text: string, words: string[], weight: number): number {
	let lower = text.toLowerCase();
	return words.every(word => lower.includes(word)) ? weight + (lower.startsWith(words[0]) ? 1 : 0) : 0;
}

function search(entries: Entry[], query: string): Hit[] {
	let words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	let out: Hit[] = [];
	for (let entry of entries) {
		let page = score(entry.title, words, 6) || score(entry.summary, words, 2);
		if (page) out.push({ href: entry.path, title: entry.title, context: entry.group, score: page });
		for (let [id, text] of entry.headings) {
			let found = score(text, words, 4);
			if (found) out.push({ href: `${entry.path}#${id}`, title: text, context: entry.title, score: found });
		}
	}
	return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

function dialog(): HTMLDialogElement | null {
	return document.querySelector<HTMLDialogElement>('#find');
}

function select(next: number): void {
	let links = dialog()?.querySelectorAll<HTMLAnchorElement>('[role=option]') ?? [];
	active = Math.max(0, Math.min(next, links.length - 1));
	links.forEach((link, i) => link.setAttribute('aria-selected', String(i === active)));
	links[active]?.scrollIntoView({ block: 'nearest' });
}

async function render(query: string): Promise<void> {
	let box = dialog();
	if (!box) return;
	index ??= fetch('/search.json').then(res => res.json());
	let words = query.toLowerCase().split(/\s+/).filter(Boolean);
	hits = search(await index, query);
	let list = box.querySelector('ol');
	let empty = box.querySelector('p');
	if (!list || !empty) return;
	list.innerHTML = hits.map((hit, i) => `<li><a id="hit-${i}" role="option" href="${hit.href}"><b>${mark(hit.title, words)}</b><small>${escape(hit.context)}</small></a></li>`).join('');
	empty.hidden = hits.length > 0 || !words.length;
	select(0);
}

function open(): void {
	let box = dialog();
	if (!box || box.open) return;
	box.showModal();
	let input = box.querySelector('input');
	if (!input) return;
	input.select();
	render(input.value);
}

function toggle(name: string, button: Element): void {
	let on = document.body.classList.toggle(name);
	button.setAttribute('aria-expanded', String(on));
}

function copy(button: HTMLElement, text: string): void {
	navigator.clipboard?.writeText(text);
	button.classList.add('done');
	if (button.dataset.copyCode !== undefined) button.textContent = 'Copied!';
	setTimeout(() => {
		button.classList.remove('done');
		if (button.dataset.copyCode !== undefined) button.textContent = 'Copy';
	}, 1200);
}

function spy(): void {
	let links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.toc a'));
	let current = links[0];
	for (let link of links) {
		let heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
		if (heading && heading.getBoundingClientRect().top < 140) current = link;
	}
	for (let link of links) {
		if (link === current) link.setAttribute('aria-current', 'true');
		else link.removeAttribute('aria-current');
	}
}

document.addEventListener('click', event => {
	let target = event.target instanceof Element ? event.target : null;
	if (!target) return;

	let button = target.closest<HTMLElement>('[data-theme-toggle], [data-menu], [data-toc], [data-copy], [data-copy-code], [data-search], [role=tab]');
	if (button?.matches('[data-theme-toggle]')) {
		root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
		return localStorage.setItem('theme', root.dataset.theme);
	}
	if (button?.matches('[data-menu]')) return toggle('nav-open', button);
	if (button?.matches('[data-toc]')) return toggle('toc-open', button);
	if (button?.matches('[data-search]')) return open();
	if (button?.dataset.copy) return copy(button, button.dataset.copy);
	if (button?.matches('[data-copy-code]')) return copy(button, button.closest('.code')?.querySelector('pre')?.textContent ?? '');
	if (button?.matches('[role=tab]')) {
		let box = button.closest('[data-tabs]');
		for (let tab of box?.querySelectorAll('[role=tab]') ?? []) {
			let selected = tab === button;
			tab.setAttribute('aria-selected', String(selected));
			tab.setAttribute('tabindex', selected ? '0' : '-1');
			let panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
			if (panel) panel.hidden = !selected;
		}
		return;
	}

	if (target.closest('.toc a, .side a')) {
		document.body.classList.remove('nav-open', 'toc-open');
		for (let pill of document.querySelectorAll('.subbar [aria-expanded]')) pill.setAttribute('aria-expanded', 'false');
	}

	let box = dialog();
	if (box?.open && (target === box || target.closest('[role=option]'))) box.close();
});

document.addEventListener('keydown', event => {
	let box = dialog();
	let typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
	if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
		event.preventDefault();
		return open();
	}
	if (event.key === 'Escape') {
		document.body.classList.remove('nav-open', 'toc-open');
	}
	if (!box?.open) return;
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		return select(active + (event.key === 'ArrowDown' ? 1 : -1));
	}
	if (event.key === 'Enter' && hits[active]) {
		event.preventDefault();
		box.close();
		navigate(hits[active].href);
	}
});

document.addEventListener('input', event => {
	if (event.target instanceof HTMLInputElement && event.target.closest('#find')) render(event.target.value);
});

addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
on('bongo:navigated', spy);
spy();
