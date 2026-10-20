export type Args = Record<string, any>;
export type Blocks = Record<string, Compiler>;

export type Compiler<T extends Args = Args> = (data: T, blocks?: Blocks) => Promise<string> | string;

export interface Options {
	loose?: boolean;
	props?: string[];
	blocks?: Blocks;
	async?: boolean;
}

export function esc(value: unknown): string;

type CompileOptions = Options & { escape?: typeof esc };
export function compile(input: string, options?: CompileOptions & { async: true }): <T extends Args> (data?: T, blocks?: Blocks) => Promise<string>;
export function compile(input: string, options?: CompileOptions & { async?: false }): <T extends Args> (data?: T, blocks?: Blocks) => string;
export function compile(input: string, options?: CompileOptions): Compiler;
