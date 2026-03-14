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
	const inputs = [
		// join(CWD, 'Counter.svelte'),
		join(CWD, 'hello.svx'),
		join(CWD, 'demo.svx'),
	];

	try {
		await service.build({
			entryPoints: inputs,
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
						mdsvex({
							extensions: ['.svx'],
							smartypants: { dashes: true },
						}),
					],
					compilerOptions: {
						hydratable: true,
						dev: isDev,
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
	const RUNTIME = join(__dirname, 'runtime.js');
	// const TAGNAME = 'HYDRATOR';

	const { emitCss, preprocess, compilerOptions={} } = options;
	const customElement = !!compilerOptions.customElement;
	// const isSSR = compilerOptions.generate === 'ssr';

	const cache_css = emitCss && new Map;
	const cache_hydrators = new Map;
	const cache_contents = new Map;
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
				entry = entry || cache_contents.get(file);

				const isDOM = !!entry; // TODO
				// const isDOM = !/\.svx$/.test(args.path); // TODO
				compilerOptions.generate = isDOM ? 'dom' : 'ssr';

				console.log('INSIDE SVELTE', file, { isDOM });
				let source = entry || await fs.readFile(file, 'utf8');
				let filename = relative(CWD, file);

				// TODO: but add `generate` mode
				// const hash = sha256(filename, source);
				// entry = cache_output.get(hash);
				// if (entry) return entry;

				HYDRATE.lastIndex = 0;

				// has <ssg:hydrate/>
				if (!isDOM && HYDRATE.test(source)) {
					let toImport = '';
					// const IMPORTS = new Map;
					const DOM = new MagicString(source);
					const SSR = new MagicString(source, { filename });
					const AST = svelte.parse(source, { filename, customElement });

					svelte.walk(AST.html, {
						enter(node) {
							if (node.type === 'Element' && node.name === 'ssg:hydrate') {
								// TODO: DOM replace with child
								let { start, end, name, attributes } = node;
								let nodeName = start + name.length + 1;

								// const hydraname = TAGNAME + (1 + cache_hydrators.size);
								const hydrahash = sha256(filename, source.substring(start, end));
								const hydrafile = file.replace(filename, hydrahash + '.hydrate.svelte');
								const innerfile = file.replace(filename, hydrahash + '.dom.svelte');

								// SSR -> keep everything
								// DOM -> inspect scopes + purge + virtual file

								SSR.overwrite(end - name.length - 3, end, `</div>`);
								SSR.overwrite(start - 1, nodeName, `<div data-hydrate="${hydrahash}"`);

								// TODO: print correct source path
								SSR.appendRight(end, `{@html '<script defer type="module" src=${JSON.stringify(hydrafile)}></script>'}`);

								// TODO: very naiive
								const references = new Set;

								let mode, props=''; //, attrs='';
								attributes.forEach(attr => {
									if (attr.type === 'Let') {
										references.add(attr.name);
										SSR.remove(attr.start, attr.end);
									} else if (attr.type === 'Attribute' && attr.name === 'mode') {
										SSR.remove(attr.start, attr.end);
										mode = attr.value[0].raw;
									}
								});

								// for (let name of variables) {
								// 	if (props) props += ',';
								// 	props += name;
								// 	// todo: if "name" ...?
								// 	if (attrs) attrs += ' ';
								// 	attrs += `{${name}}`;
								// }

								node.children.forEach(kid => {
									if (kid.type === 'InlineComponent') {
										references.add(kid.name);
									}
								});

								svelte.walk(AST.html, {
									enter(node) {
										if (node.type === 'Element' && node.name === 'ssg:hydrate') {
											let first = node.children.shift();
											let last = node.children.pop();
											if (!first && !last) {
												DOM.remove(node.start, node.end);
											} else {
												let start = first.start;
												let end = (last || first).end;
												DOM.overwrite(
													node.start, node.end,
													source.substring(start, end)
												);
											}
											this.skip();
										} else if (node.type !== 'Program' && node.type !== 'Fragment') {
											DOM.remove(node.start, node.end);
											this.skip(); // skip inners
										}
									}
								});

								if (AST.instance) {
									svelte.walk(AST.instance, {
										enter(node) {
											// VERY WRONG / NAIIVE
											if (node.type === 'ImportDeclaration') {
												let found = node.specifiers.find(x => references.has(x.local.name));
												found || DOM.remove(node.start, node.remove);
												this.skip();
											} else if (node.type === 'VariableDeclarator') {
												let found = references.has(node.id.name);
												found || DOM.remove(node.start, node.remove);
												this.skip();
											}
										}
									});
								}

								// TODO: mount [data-hydrate] styles once (HTML)
								// <style>:global([data-hydrate]){display:contents}</style>

								mode = mode || 'idle';

								// TODO: pass in props somehow
								let hydrasource = `
									<script>
										import {onMount} from 'svelte';
									import {${mode}} from ${JSON.stringify(RUNTIME)};
									import Contents from ${JSON.stringify(innerfile)};
										${props && `export let ${props};`}
										onMount(() => {
									var ctx, elem = document.querySelector('div[data-hydrate="${hydrahash}"]');
									if (elem) return (ctx = new Contents({ target: elem, props: {${props}} })).$destroy;
											// ${mode}('${hydrahash}', {${props}}));
										});
									</script>
								`;

								toImport += `/*#__PURE__*/import(${JSON.stringify(hydrafile)});`;
								// toImport += `/*#__PURE__*/import(${JSON.stringify(innerfile)});`;

								cache_hydrators.set(hydrafile, hydrasource);
								cache_contents.set(innerfile, DOM.toString());

								console.log('HYDRATE\n', hydrasource);
								console.log('---');
								console.log('DOM\n', DOM.toString());
								console.log('---');
							}
						}
					});

					// attach `hydrator` component(s)
					if (AST.instance) {
						// NOTE: svelte/types/compiler/interfaces
						//=> Script @ Program needs start|end
						SSR.prependLeft(AST.instance.content.start, toImport);
					} else {
						SSR.append(`<script>${toImport}</script>`);
					}

					source = SSR.toString();
					compilerOptions.sourcemap = SSR.generateMap();
					console.log('SSR\n', source);
					console.log('---');
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
