// This fixture exercises the engine plumbing — `output:` literal-output
// pages, `$blocks` registration, and the `<bongo:feed/>` ⇄ `{{#feed}}`
// pre-pass — by inlining a tiny stand-in for `@bongo/feed`. The real
// plugin's behaviour is covered exhaustively in
// `packages/plugin.feed/src/index.test.ts`.
//
// We can't `import { feed } from '@bongo/feed'` here because the fixture is
// copied into a temp dir for isolation (no resolvable node_modules), and
// relative `../../..` imports break under the same copy.

type FakePage = {
	path: string;
	url: string;
	title: string;
	summary: string;
	feeds?: { format: string; path: string; title: string; type: string; url: string }[];
	params: Record<string, unknown>;
};

type FakeItem = {
	title: string;
	url: string;
	summary: string;
	date: unknown;
};

function xml(value: unknown): string {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function defaultRender(page: FakePage): FakeItem {
	return {
		title: page.title,
		url: page.url,
		summary: page.summary,
		date: page.params.date,
	};
}

function atom(title: string, feedUrl: string, siteUrl: string, items: FakeItem[]): string {
	let out = '<?xml version="1.0" encoding="utf-8"?>\n';
	out += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
	out += `<title>${xml(title)}</title>\n`;
	out += `<id>${xml(feedUrl)}</id>\n`;
	out += `<link href="${xml(feedUrl)}" rel="self" type="application/atom+xml"/>\n`;
	out += `<link href="${xml(siteUrl)}"/>\n`;
	if (items.length > 0) {
		// Skip <updated> on empty feeds — see plugin.feed for the same rule.
		let latest = items.reduce((acc, it) => {
			let t = new Date(String(it.date || 0)).getTime();
			return t > acc ? t : acc;
		}, 0);
		if (latest > 0) out += `<updated>${xml(new Date(latest).toISOString())}</updated>\n`;
	}
	for (let item of items) {
		out += '<entry>\n';
		out += `<title>${xml(item.title)}</title>\n`;
		out += `<id>${xml(item.url)}</id>\n`;
		out += `<link href="${xml(item.url)}"/>\n`;
		if (item.date) out += `<updated>${xml(new Date(String(item.date)).toISOString())}</updated>\n`;
		if (item.summary) out += `<summary>${xml(item.summary)}</summary>\n`;
		out += '</entry>\n';
	}
	out += '</feed>\n';
	return out;
}

export default {
	$site: {
		url: 'https://example.com/',
		title: 'Feed Fixture',
		lang: 'en',
	},
	$blocks: {
		feed(args: Record<string, unknown>): string {
			let typed = args as {
				format?: string;
				title?: string;
				url?: string;
				items?: FakePage[];
			};
			let title = typed.title || '';
			let feedUrl = typed.url || '';
			let items = (typed.items || []).map(defaultRender);
			return atom(title, feedUrl, 'https://example.com/', items);
		},
	},
	$hooks: {
		pages({ pages }: { pages: FakePage[] }) {
			// Find feed pages (frontmatter has `output:` + `attach:`).
			let regs = pages.filter(p => typeof p.params.output === 'string' && typeof p.params.attach === 'string');
			for (let page of pages) {
				if (regs.includes(page)) continue;
				for (let reg of regs) {
					let scope = String(reg.params.attach);
					if (!scope.endsWith('/')) scope += '/';
					if (!page.path.startsWith(scope)) continue;
					let list = page.feeds || [];
					list.push({
						format: typeof reg.params.format === 'string' ? reg.params.format : 'rss',
						path: String(reg.params.output),
						title: typeof reg.params.title === 'string' ? reg.params.title : '',
						type: 'application/atom+xml',
						url: reg.url,
					});
					page.feeds = list;
				}
			}
		},
	},
};
