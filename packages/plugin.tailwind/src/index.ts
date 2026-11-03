import { dirname } from 'node:path';

import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

import type { Config } from 'bongo';

// A stylesheet that uses Tailwind: one that imports it, or uses one of its at-rules.
const TAILWIND = /@import\s+(['"])tailwindcss\1|@(?:tailwind|theme|utility|variant|custom-variant|plugin|config|source|apply)\b/;

// Scripts can add classes that no page has yet, such as a class that opens a menu.
const SCRIPTS = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

// `Features.Utilities` of Tailwind, a const enum: the stylesheet writes utilities, so it needs the classes of the pages.
const UTILITIES = 16;

/**
 * Build each stylesheet that uses Tailwind from the class names of every page, as bongo renders them,
 * plus the scripts next to the stylesheet and each `@source` that it names.
 * @example
 * import { tailwind } from '@bongo/tailwind';
 * export default { plugins: [tailwind()] };
 */
export function tailwind(): Partial<Config> {
	return {
		$build: { classes: true },
		$loaders: {
			async css(file, content, utils) {
				let text = typeof content === 'string' ? content : utils.decode(content);
				if (!TAILWIND.test(text)) return { filename: file, content: text };

				let base = dirname(file);
				let compiler = await compile(text, { base, from: file, shouldRewriteUrls: true, onDependency() {} });
				// a stylesheet that only applies or references utilities, as a CSS module can, builds while a page renders, before any page has its classes
				if (!(compiler.features & UTILITIES)) return { filename: file, content: compiler.build([]) };

				let { root } = compiler;
				let scripts = root === 'none' ? [] : [{ base: root?.base ?? base, pattern: root?.pattern ?? SCRIPTS, negated: false }];
				let scanner = new Scanner({ sources: [...scripts, ...compiler.sources] });

				return { filename: file, content: compiler.build([...utils.classes(), ...scanner.scan()]) };
			},
		},
	};
}
