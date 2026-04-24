import type { CodeBlockHighlighter } from 'md4x';
import type { createHighlighter } from 'shiki';

export type ShikiOptions = {
	theme: string;
	langs?: Parameters<typeof createHighlighter>[0]['langs'];
};

export function shiki(options: ShikiOptions): Promise<CodeBlockHighlighter>;
export function sugarhigh(): Promise<CodeBlockHighlighter>;
