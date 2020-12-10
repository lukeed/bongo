const fs = require('fs').promises;
const esbuild = require('esbuild');
const { createHash } = require('crypto');
const { join, relative } = require('path');
const svelte = require('svelte/compiler');
const { mdsvex } = require('mdsvex');
const MagicString = require('magic-string').default;

const CWD = join(__dirname, 'example');
const isDev = false;

function sha256(filename, contents) {
	return createHash('sha256').update(filename + contents).digest('hex');
}

(async function () {
	const service = await esbuild.startService();

	try {
		await service.build({
			entryPoints: [
				// join(CWD, 'Counter.svelte'),
				join(CWD, 'hello.svx'),
				join(CWD, 'demo.svx'),
			],
			bundle: true,
			format: 'esm',
			splitting: true,
			outdir: join(__dirname, 'build'),
			// minify: !isDev,
			external: [
				// 'svelte',
			],
			plugins: [
				plugin_svelte({
					emitCss: true,
					preprocess: [
						// {
						// 	script: (input) => {
						// 		console.log('I SEE', input);
						// 		return { code: input.content };
						// 	},
						// },
						mdsvex({
							extensions: ['.svx'],
							smartypants: { dashes: true },
						}),
					],
					compilerOptions: {
						generate: 'ssr',
						hydratable: true,
						dev: false,
					}
				}),
			]
		});

		console.log('~> done');
	} finally {
		service.stop();
	}
})().catch(err => {
	console.error('ERROR', err.stack || err);
	process.exit(1);
});

/**
 * @typedef Preprocessor
 * @type {import('svelte/types/compiler/preprocess').PreprocessorGroup}
 */

/**
 * @typedef Program
 * @type {import('estree').Program & { start: number, end: number }}
 */

/**
 * @typedef Script
 * @type {import('svelte/types/compiler/interfaces').Script & { content: Program }}
 */

/** @returns {import('esbuild').Plugin} */
function plugin_svelte(options) {
	const HYDRATE = /<\/?ssg:hydrate.*(?:>)/g;
	// const HYDRATOR = join(__dirname, 'hydrator.svelte');
	const TAGNAME = 'HYDRATOR';

	const { emitCss, preprocess, compilerOptions={} } = options;
	const customElement = !!compilerOptions.customElement;
	const isSSR = compilerOptions.generate === 'ssr';

	const cache_css = emitCss && new Map;
	const cache_hydrators = new Map;
	const cache_output = new Map;

	return {
		name: 'svelte',
		setup(build) {
			if (emitCss) {
				// claim Svelte stylesheets; add namespace
				build.onResolve({ filter: /\.css$/ }, args => {
					if (/\.(svx|svelte)$/.test(args.importer)) {
						return { path: args.path, namespace: 'svelte' };
					}
				});

				// load/pitch Svelte stylesheet contents
				build.onLoad({ filter: /\.css$/, namespace: 'svelte' }, args => {
					return {
						loader: 'css',
						contents: cache_css.get(args.path),
					}
				});
			}

			// deal with the component files
			build.onLoad({ filter: /\.(svx|svelte)$/ }, async (args) => {
				// This converts a message in Svelte's format to esbuild's format
				let convertMessage = ({ message, start, end }) => {
					let location
					if (start && end) {
						let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1]
						let lineEnd = start.line === end.line ? end.column : lineText.length
						location = {
							file: filename,
							line: start.line,
							column: start.column,
							length: lineEnd - start.column,
							lineText,
						}
					}
					return { text: message, location }
				}

				const file = args.path;
				// dynamically-created hydrators
				let entry = cache_hydrators.get(file);
				const isHydrator = !!entry;

				console.log('INSIDE SVELTE', file, { isHydrator });
				let source = entry || await fs.readFile(file, 'utf8');
				let filename = relative(CWD, file);

				const hash = sha256(filename, source);
				entry = cache_output.get(hash);
				if (entry) return entry;

				let hydrator = false;
				HYDRATE.lastIndex = 0;

				// has <ssg:hdyrate/>
				if (!cache_hydrators.has(file) && HYDRATE.test(source)) {
					hydrator = true;

					let IMPORTS = '';
					const MS = new MagicString(source, { filename });
					const AST = svelte.parse(source, { filename, customElement });

					await svelte.walk(AST.html, {
						enter(node) {
							if (node.type !== 'Element' && node.name !== 'ssg:hydrate') return;
							let { start, end, name, attributes } = node;
							let nodeName = start + name.length + 1;

							let hydraname = TAGNAME + (1 + cache_hydrators.size);
							let hydrafile = file.replace(filename, hydraname + '.svelte');
							// let hasMode = false;

							// SSR -> keep everything
							// DOM -> inspect scopes + purge + virtual file

							if (isSSR) {
								MS.overwrite(start - 1, nodeName, `<${hydraname}`);
								MS.overwrite(end - name.length - 3, end, `</${hydraname}>`);
							}

							// if (isSSR) {
							// 	do {
							// 		// TODO: something else?
							// 		//=> <div data-hydrate=[mode]/>
							// 		//=> save `let:*` ~>
							// 		ms.remove(match.index, match[0].length);
							// 	} while (match = Needle.exec(input.content));
							// } else {
							// 	do {
							// 		// TODO: placeholder
							// 		ms.overwrite(match.index, match.index + match[0].length, '<Hello/>');
							// 	} while (match = Needle.exec(input.content));
							// }

							// let props = {};
							// attributes.forEach(attr => {
							// 	if (attr.type === 'Let') {
							// 		props[attr.name] = attr.expression ? attr.expression.name : attr.name;
							// 	} else if (attr.type === 'Attribute' && attr.name === 'mode') {
							// 		hasMode = true;
							// 		MS.overwrite(
							// 			attr.start, attr.end,
							// 			`data-hydrate=${attr.value[0].raw}`
							// 		);
							// 	}
							// });

							// hasMode || MS.appendRight(nodeName, ` data-hydrate=idle`)

							let vars = new Set;
							attributes.forEach(attr => {
								if (attr.type === 'Let') {
									vars.add(attr.name);
								}
							});

							let props='', attrs='';
							for (let name of vars) {
								if (props) props += ',';
								props += name;
								// todo: if "name" ...?
								if (attrs) attrs += ' ';
								attrs += `{${name}}`;
							}

							// TODO: hash from somewhere
							// TODO: mount [data-hydrate] styles once (HTML)
							// <style>:global([data-hydrate]){display:contents}</style>
							let hydrasource = `
								<script>
									export let mode='idle';
									export let ${props};
								</script>
								<div data-hydrate={mode}>
									<slot ${attrs}/>
								</div>
							`;

							IMPORTS += `import ${hydraname} from ${JSON.stringify(hydrafile)};`;
							cache_hydrators.set(hydrafile, hydrasource);
						}
					});

					// attach `hydrator` component
					if (hydrator && AST.instance) {
						// NOTE: svelte/types/compiler/interfaces
						//=> Script @ Program needs start|end
						MS.prependLeft(AST.instance.content.start, IMPORTS);
					} else if (hydrator) {
						MS.append(`<script>${IMPORTS}</script>`);
					}

					source = MS.toString();
					compilerOptions.sourcemap = MS.generateMap();
				} //=> </ssg:hydrate>


				if (preprocess) {
					let output = await svelte.preprocess(source, preprocess, { filename });
					// console.log('> output.dependencies', output.dependencies);
					// TODO: not sure what to do/hwo to combine with `MS.generateMap` here
					if (output.map) compilerOptions.sourcemap = output.map;
					source = output.code;
				}

				try {
					compilerOptions.filename = filename;
					// svelte.walk()
					let output = svelte.compile(source, compilerOptions);
					// console.log('~> output.vars', output.vars);
					let { js, css, warnings } = output;

					let content = js.code;
					if (emitCss && css.code) {
						const fname = file.replace(/\.(svx|svelte)$/, '.css');
						content += `\nimport ${JSON.stringify(fname)};\n`;
						// TODO: full `css` object – for sourcemap
						cache_css.set(fname, css.code);
					}

					if (js.map) {
						content += `//# sourceMappingURL=` + js.map.toUrl()
					}

					// if (/\.svx$/.test(filename)) {
					// 	console.log('YES', filename);
					// }

					return {
						contents: content,
						warnings: warnings.map(convertMessage)
					};
				} catch (err) {
					return {
						errors: [convertMessage(err)]
					}
				}
			});
		}
	};
}
