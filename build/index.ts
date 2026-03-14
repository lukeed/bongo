import { build, list } from './util';

const pkgs = await list();

await Promise.all(
	pkgs.map(build)
);

console.log('~> Done 🎉');
