import { join } from 'path';
import * as fs from './fs';

type Dict<T> = Record<string, T>;

interface Template {
	slots: Dict<any>;
	render(props: Dict<any>): string;
}

type Layouts = Map<string, Template>;
type Partials = Map<string, Template>;

export async function collect(cwd: string) {
	const dir = join(cwd, 'layouts');
	if (!fs.exists(dir)) throw new Error('Missing "layouts" directory');

	const layouts: Layouts = new Map;
	const partials: Partials = new Map;

	const isWindows = process.platform === 'win32';
	const hasPartials = fs.exists(join(dir, 'partials'));

	await fs.totalist(dir, (rel, abs) => {
		if (isWindows) rel = rel.replace(/[\\]+/g, '/');
		let target = hasPartials && rel.startsWith('partials/') ? partials : layouts;
		target.set(name, {
			slots: {},
			render: (...args) => `i got: ${JSON.stringify(args)}`
		})
	});

	return { layouts, partials };
}
