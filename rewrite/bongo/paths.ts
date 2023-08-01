import * as path from 'node:path';

export const ROOT = path.resolve('.');
export const ASSETS = path.join(ROOT, 'assets');
export const CONTENT = path.join(ROOT, 'content');
export const PARTIALS = path.join(ROOT, 'partials');
export const LAYOUTS = path.join(ROOT, 'layouts');
export const PUBLIC = path.join(ROOT, 'public');

export const isHBS = /\.hbs$/;
export const isPAGE = /\.(hbs|html)$/
