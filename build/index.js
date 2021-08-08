const { build, list } = require('./util');

(async function () {
	let pkgs = await list();
	await Promise.all(
		pkgs.map(build)
	);

	console.log('~> Done 🎉');
})().catch(err => {
	console.error('Oops~!', err.stack);
	process.exitCode = 1;
});
