import { SITE, pages, path } from '../lib';

export async function GET() {
	let urls = (await pages()).map(page => `\t<url><loc>${new URL(path(page), SITE.url).href}</loc></url>`);
	let body = `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
	return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
