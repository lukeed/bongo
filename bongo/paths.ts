import { dirname, join, resolve, } from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dirname = dirname(
	fileURLToPath(import.meta.url)
);

export const ROOT = resolve('.');
export const ASSETS = join(ROOT, 'assets');
export const CONTENT = join(ROOT, 'content');
export const PARTIALS = join(ROOT, 'partials');
export const LAYOUTS = join(ROOT, 'layouts');
export const PUBLIC = join(ROOT, 'public');
