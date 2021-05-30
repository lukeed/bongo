import * as fs from 'fs';
import { join } from 'path';
import { promisify } from 'util';

export const exists = fs.existsSync;
export const ls = promisify(fs.readdir);
export const write = promisify(fs.writeFile);
export const lstat = promisify(fs.lstat);

// @see lukeed/totalist
export type Caller = (rel: string, abs: string, stats: fs.Stats) => any;
export async function totalist(dir: string, callback: Caller, pre='') {
	await ls(dir).then(arr => {
		return Promise.all(
			arr.map(str => {
				let abs = join(dir, str);
				return lstat(abs).then(stats => {
					return stats.isDirectory()
						? totalist(abs, callback, join(pre, str))
						: callback(join(pre, str), abs, stats)
				});
			})
		);
	});
}
