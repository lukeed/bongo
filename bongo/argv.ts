export let DEV = false;
export let BUILD = false;
export let MINIFY = false;

// TODO: cwd?

export interface Argv {
	cmd?: string;
	minify?: boolean;
	version?: boolean;
	public?: boolean;
	help?: boolean;
};

export function parse(argv: string[]): Required<Argv> {
	let i=0, len=argv.length, c='', tmp: string;
	let flags: Record<`-${string}`, boolean> = {};
	for (; i < len; i++) {
		tmp = argv[i];
		if (tmp.charCodeAt(0) !== 45) c = c || tmp; // command
		else flags[tmp as `-${string}`] = true;
	}
	let output: Required<Argv> = {
		cmd: (c || '').toLowerCase(),
		minify: !!(flags['--minify'] || flags['-m']),
		version: !!(flags['--version'] || flags['-v']),
		public: !!(flags['--public'] || flags['-H']),
		help: !!(flags['--help'] || flags['-h']),
	};

	// update env values
	MINIFY = output.minify;
	BUILD = c === 'build';
	DEV = c === 'dev';

	return output;
}
