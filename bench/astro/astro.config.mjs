import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://bench.example.com/',
	trailingSlash: 'always',
	prefetch: true,
	build: { inlineStylesheets: 'never' },
	markdown: {
		shikiConfig: { theme: 'github-light' },
	},
});
