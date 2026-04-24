import type { BundledLanguage } from 'shiki';
import type { CodeBlockHighlighter } from 'md4x';

export type ShikiOptions = {
	theme: string;
	langs?: BundledLanguage[];
};

export function shiki(options: ShikiOptions): Promise<CodeBlockHighlighter>;
export function sugarhigh(): Promise<CodeBlockHighlighter>;
