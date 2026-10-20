import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pages = defineCollection({
	loader: glob({ pattern: '**/*.md', base: '../site/content' }),
	schema: z.object({
		title: z.string(),
		summary: z.string().optional(),
		date: z.coerce.date().optional(),
		tags: z.string().optional().transform(value => value ? value.split(/,\s*/) : []),
	}),
});

export const collections = { pages };
