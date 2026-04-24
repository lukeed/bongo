import type { CodeBlockHighlighter } from 'md4x';

export type Highlighter = CodeBlockHighlighter & {
	load(): Promise<void>;
};

export type ShikiOptions = {
	theme: string;
	langs?: string[];
};

export function shiki(options: ShikiOptions): Highlighter;
export function sugarhigh(): Highlighter;
