const path = require('path');
const fs = require('fs');
const sirv = require('sirv');
const http = require('http');

const rm = fs.promises.rm || fs.promises.rmdir;
const ls = fs.promises.readdir;
const read = fs.promises.readFile;
async function rmdir(path) {
  !fs.existsSync(path) || await rm(path, { recursive: true });
}
async function mkdir(input) {
  if (fs.existsSync(input = path.dirname(input)))
    return;
  await fs.promises.mkdir(input, { recursive: true });
}
function assert(path, msg = "") {
  if (!fs.existsSync(path))
    throw new Error(`Missing "${msg || path}" file!`);
}
async function write(file, data) {
  await mkdir(file);
  await fs.promises.writeFile(file, data);
}
async function copy(src, dest) {
  await mkdir(dest);
  await fs.promises.copyFile(src, dest);
}
async function load$1(ident, dir = "") {
  try {
    if (dir)
      ident = path.join(dir, ident);
    return await Function("x", 'return import("file:///" + x)')(ident);
  } catch (err) {
    if (err.code !== "ERR_UNKNOWN_FILE_EXTENSION")
      throw err;
    return require(ident);
  }
}
async function list(dir, callback, prefix = "") {
  let files = await ls(dir, { withFileTypes: true });
  await Promise.all(files.map((dirent) => {
    let item = path.join(dir, dirent.name);
    let rel = path.join(prefix, dirent.name);
    if (dirent.isFile())
      return callback(item, rel, dirent.name);
    return /^(shortcode|partial)s$/.test(dirent.name) || list(item, callback, rel);
  }));
}
async function setup(dir, onChange) {
  let output = {};
  try {
    output[dir] = fs.watch(dir, { recursive: true }, onChange.bind(0, dir));
  } catch (err) {
    if (err.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM")
      throw err;
    output[dir] = fs.watch(dir, onChange.bind(0, dir));
    await list(dir, (rel, abs) => {
      output[abs] = fs.watch(abs, onChange.bind(0, abs));
    });
  }
  return output;
}
async function watch(list2, callback) {
  const dirs = new Set(list2.filter(fs.existsSync));
  let wip = 0;
  const Triggers = /* @__PURE__ */ new Set();
  const Watchers = /* @__PURE__ */ new Map();
  async function handle() {
    await callback();
    if (--wip)
      return handle();
  }
  async function onChange(dir2, filename) {
    let tmp = path.join(dir2, filename);
    if (Triggers.has(tmp))
      return;
    if (wip++)
      return wip = 1;
    console.clear();
    Triggers.add(tmp);
    await handle();
    Triggers.delete(tmp);
  }
  let dir, output, key;
  for (dir of dirs) {
    output = await setup(dir, onChange);
    for (key in output)
      Watchers.set(key, output[key]);
  }
}

function debug(...msg) {
  console.log("[DEBUG]", ...msg);
}

let INPUTS = {};
let CONFIGS = {};
let BUNDLERS = {};
let esbuild;
let defaults = {
  bundle: true,
  splitting: true,
  resolveExtensions: [".ts", ".js", ".cjs", ".mjs", ".css", ".json"],
  mainFields: ["browser", "module", "jsnext", "main"],
  conditions: ["browser", "import", "production"],
  platform: "neutral",
  incremental: false,
  sourcemap: false,
  minify: true,
  publicPath: "/",
  write: true,
  metafile: true,
  allowOverwrite: true,
  entryNames: "[name].[hash]",
  chunkNames: "[name].[hash]"
};
function toGroup(options) {
  return (options.format || "") + "~" + String(options.target || "");
}
function reset() {
  INPUTS = {};
  CONFIGS = {};
  BUNDLERS = {};
}
function prebuild(input, config) {
  let group = toGroup(config);
  let inputs = INPUTS[group] || /* @__PURE__ */ new Set();
  CONFIGS[group] = CONFIGS[group] || config;
  INPUTS[group] = inputs;
  inputs.add(input);
  return group;
}
function build$1(group) {
  esbuild = esbuild || require("esbuild");
  let thunk = BUNDLERS[group];
  if (thunk)
    return thunk;
  let inputs = INPUTS[group];
  let options = CONFIGS[group];
  if (!inputs || !inputs.size || !options) {
    throw new Error("invalid group");
  }
  options.entryPoints = [...inputs];
  options = { ...defaults, ...options };
  return BUNDLERS[group] = esbuild.build(options);
}
function postbuild(entry, result) {
  let key, tmp;
  for (key in result.metafile.outputs) {
    tmp = result.metafile.outputs[key];
    if (tmp.entryPoint === entry)
      return key;
  }
  throw new Error(`Missing output for "${entry}" entrypoint`);
}
async function transform(filename) {
  esbuild = esbuild || require("esbuild");
  require.extensions[".ts"] = require.extensions[".ts"] || function(Module, filename2) {
    const pitch = Module._compile.bind(Module);
    Module._compile = (source) => {
      const { code, warnings } = esbuild.transformSync(source, {
        minify: true,
        format: "cjs",
        sourcemap: "inline",
        sourcefile: filename2,
        loader: "ts"
      });
      warnings.forEach((msg) => {
        console.warn(`
esbuild warning in ${filename2}:`);
        console.warn(msg.location);
        console.warn(msg.text);
      });
      return pitch(code, filename2);
    };
    require.extensions[".js"](Module, filename2);
  };
  return require(filename);
}

const priority = [
  "bongo.config.ts",
  "bongo.config.mjs",
  "bongo.config.cjs",
  "bongo.config.js"
];
async function find(root, start) {
  let i = 0, dir = path.resolve(root, start);
  let files = new Set(await ls(dir));
  for (; i < priority.length; i++) {
    if (files.has(priority[i])) {
      return path.join(dir, priority[i]);
    }
  }
  dir = path.dirname(dir);
  if (dir.startsWith(root)) {
    return find(root, dir);
  }
}
function merge(base, custom) {
  if (custom.plugins) {
    custom.plugins.forEach((o) => merge(base, o));
  }
  Object.assign(base.$site, custom.$site);
  Object.assign(base.$assets, custom.$assets);
  Object.assign(base.$partials, custom.$partials);
  for (let key in custom.$utils) {
    if (typeof custom.$utils[key] !== "object") {
      base.$utils[key] = custom.$utils[key];
    } else {
      base.$utils[key] = Object.assign(base.$utils[key], custom.$utils[key]);
    }
  }
}
async function load(root) {
  let output = {
    $site: {
      url: "",
      lang: "",
      title: "",
      description: "",
      menu: {}
    },
    $utils: {
      truncate(text, length) {
        return (text || "").substring(0, length);
      },
      countwords(text) {
        return text.split(/\s+/g).length;
      },
      url: {
        abs(to, fro) {
          return new URL(to, fro || output.$site.url).pathname;
        }
      },
      date: {
        format(value, format) {
          let d = new Date(value);
          return d.toISOString();
        }
      }
    },
    $assets: {},
    $partials: {},
    plugins: []
  };
  let file = await find(root, ".");
  if (file) {
    let user = /\.ts$/.test(file) ? await transform(file) : await load$1(file);
    merge(output, user.default || user);
  } else {
    throw new Error("Missing configuration file");
  }
  return output;
}

// TODO: blocks.setup hook
// TODO? add `#expr` for js stmt/logic
const ESCAPE = /[&"<]/g, CHARS = {
	'"': '&quot;',
	'&': '&amp;',
	'<': '&lt',
};

const ENDLINES = /[\r\n]+$/g;
const CURLY = /{{{?\s*([\s\S]*?)\s*}}}?/g;
const VAR = /(?:^|[-*+^|%/&=\s])([a-zA-Z$_][\w$]*)(?:(?=$|[-*+^|%/&=\s]))/g;
const ARGS = /([a-zA-Z$_][^\s=]*)\s*=\s*((["`'])(?:(?=(\\?))\4.)*?\3|{[^}]*}|\[[^\]]*]|\S+)/g;

// $$1 = escape()
// $$2 = extra blocks
// $$3 = template values
function gen(input, options) {
	options = options || {};

	let char, num, action, tmp;
	let last = CURLY.lastIndex = 0;
	let wip='', txt='', match, inner;

	let extra=options.blocks||{}, stack=[];
	let initials = new Set(options.props||[]);

	function close() {
		if (wip.length > 0) {
			txt += (txt ? 'x+=' : '=') + '`' + wip + '`;';
		} else if (txt.length === 0) {
			txt = '="";';
		}
		wip = '';
	}

	while (match = CURLY.exec(input)) {
		wip += input.substring(last, match.index).replace(ENDLINES, '');
		last = match.index + match[0].length;

		inner = match[1].trim();
		char = inner.charAt(0);

		if (char === '!') ; else if (char === '#') {
			close();
			[, action, inner] = /^#\s*(\w[\w\d./]+)\s*([^]*)/.exec(inner);

			if (action === 'expect') {
				inner.split(/[\n\r\s\t]*,[\n\r\s\t]*/g).forEach(key => {
					initials.add(key);
				});
			} else if (action === 'var') {
				num = inner.indexOf('=');
				tmp = inner.substring(0, num++).trim();
				inner = inner.substring(num).trim().replace(/[;]$/, '');
				txt += `var ${tmp}=${inner};`;
			} else if (action === 'each') {
				num = inner.indexOf(' as ');
				stack.push(action);
				if (!~num) {
					txt += `for(var i=0,$$a=${inner};i<$$a.length;i++){`;
				} else {
					tmp = inner.substring(0, num).trim();
					inner = inner.substring(num + 4).trim();
					let [item, idx='i'] = inner.replace(/[()\s]/g, '').split(','); // (item, idx?)
					txt += `for(var ${idx}=0,${item},$$a=${tmp};${idx}<$$a.length;${idx}++){${item}=$$a[${idx}];`;
				}
			} else if (action === 'if') {
				txt += `if(${inner}){`;
				stack.push(action);
			} else if (action === 'elif') {
				txt += `}else if(${inner}){`;
			} else if (action === 'else') {
				txt += `}else{`;
			} else if (action in extra) {
				if (inner) {
					tmp = [];
					// parse arguments, `defer=true` -> `{ defer: true }`
					while (match = ARGS.exec(inner)) tmp.push(match[1] + ':' + match[2]);
					inner = tmp.length ? '{' + tmp.join() + '}' : '';
				}
				inner = inner || '{}';
				tmp = options.async ? 'await ' : '';
				wip += '${' + tmp + '$$2["' + action + '"](' + inner + ',$$2)}';
			} else {
				throw new Error(`Unknown "${action}" block`);
			}
		} else if (char === '/') {
			action = inner.substring(1);
			inner = stack.pop();
			close();
			if (action === inner) txt += '}';
			else throw new Error(`Expected to close "${inner}" block; closed "${action}" instead`);
		} else {
			if (match[0].charAt(2) === '{') wip += '${' + inner + '}'; // {{{ raw }}}
			else wip += '${$$1(' + inner + ')}';
			if (options.loose) {
				while (tmp = VAR.exec(inner)) {
					initials.add(tmp[1]);
				}
			}
		}
	}

	if (stack.length > 0) {
		throw new Error(`Unterminated "${stack.pop()}" block`);
	}

	if (last < input.length) {
		wip += input.substring(last).replace(ENDLINES, '');
	}

	close();

	tmp = initials.size ? `{${ [...initials].join() }}=$$3,x` : ' x';
	return `var${tmp + txt}return x`;
}

function esc(value) {
	if (typeof value !== 'string') return value;
	let last=ESCAPE.lastIndex=0, tmp=0, out='';
	while (ESCAPE.test(value)) {
		tmp = ESCAPE.lastIndex - 1;
		out += value.substring(last, tmp) + CHARS[value[tmp]];
		last = tmp + 1;
	}
	return out + value.substring(last);
}

function compile(input, options={}) {
	return new (options.async ? (async()=>{}).constructor : Function)(
		'$$1', '$$2', '$$3', gen(input, options)
	).bind(0, options.escape || esc, options.blocks);
}

const Layouts = /* @__PURE__ */ new Map();
const Partials = /* @__PURE__ */ new Map();
function toPartialName(file) {
  let { ext } = path.parse(file);
  return file.substring(0, file.length - ext.length);
}
async function collect(argv, config) {
  let opts = {
    outdir: argv.dest,
    absWorkingDir: argv.cwd,
    publicPath: new URL(config.$site.url).pathname,
    minify: argv.minify
  };
  let toOutfile = (file) => {
    file = path.join(argv.cwd, file);
    file = path.relative(argv.dest, file);
    return config.$utils.url.abs(file);
  };
  let blocks = {
    partial(args) {
      let { src, ...rest } = args;
      let key = toPartialName(src);
      let render = Partials.get(key);
      if (render)
        return render(rest);
      throw new Error(`Unknown "${key}" partial!`);
    },
    async style(args) {
      let { src, output, preload, inline } = args;
      if (!src)
        throw new Error('Missing "src" argument');
      let input = path.join(argv.assets, src);
      assert(input, `assets/${src}`);
      let options2 = { ...opts };
      if (output) {
        delete options2.outdir;
        options2.splitting = false;
        options2.outfile = path.join(argv.dest, output);
      }
      let entry = path.relative(argv.cwd, input);
      let group = prebuild(input, options2);
      let result = await build$1(group);
      let outfile = postbuild(entry, result);
      if (inline) {
        outfile = path.join(argv.cwd, outfile);
        let contents = await read(outfile, "utf8");
        return `<style>${contents}</style>`;
      }
      outfile = toOutfile(outfile);
      let plain = `<link rel="stylesheet" href="${outfile}"/>`;
      if (!preload)
        return plain;
      let html = `<link rel="preload" href="${outfile}" as="style"`;
      html += ` onload="this.onload=null;this.rel='stylesheet'"/>`;
      html += `<noscript>${plain}</noscript>`;
      return html;
    },
    async script(args) {
      let { src, target, format, async, defer, inline } = args;
      if (!src)
        throw new Error('Missing "src" argument');
      let input = path.join(argv.assets, src);
      assert(input, `assets/${src}`);
      let options2 = { ...opts };
      options2.target = target || "es2017";
      options2.format = format || "esm";
      let entry = path.relative(argv.cwd, input);
      let group = prebuild(input, options2);
      let result = await build$1(group);
      let outfile = postbuild(entry, result);
      let html = "<script";
      if (async)
        html += " async";
      if (options2.format === "esm") {
        html += " type=module";
      } else if (defer) {
        html += " defer";
      }
      if (inline) {
        outfile = path.join(argv.cwd, outfile);
        let contents = await read(outfile, "utf8");
        html += ">" + contents + "<\/script>";
      } else {
        outfile = toOutfile(outfile);
        html += ` src="${outfile}"><\/script>`;
      }
      return html;
    }
  };
  let props = ["$site", "$page", "$assets", "$utils"];
  let options = { async: true, props, blocks };
  async function compile$1(dir, rel) {
    try {
      let file = path.join(dir, rel);
      let content = await read(file, "utf8");
      return compile(content, options);
    } catch (err) {
      let type = path.parse(dir).name.slice(0, -1);
      let tmp = new Error(`Error compiling "${rel}" ${type}!`);
      if (!(err instanceof SyntaxError)) {
        tmp.message += "\n	" + err.message;
      }
      throw tmp;
    }
  }
  let isHBS = /\.hbs$/i;
  let isJS = /\.([mc]?js|ts)$/i;
  let { layouts, partials } = argv;
  let debug$1 = argv.debug ? debug : () => {
  };
  if (fs.existsSync(partials)) {
    await list(partials, async (_, rel) => {
      if (isHBS.test(rel) || isJS.test(rel)) {
        let key = toPartialName(rel);
        debug$1("[collect.partials]", key);
        Partials.set(key, blocks[key] = rel);
      }
    });
    for (let [key, rel] of Partials) {
      let file = String(rel);
      let render = isHBS.test(file) ? await compile$1(partials, file) : await load$1(file, partials);
      render = render.default || render;
      let compiler = (x) => render({ ...x, ...config }, blocks);
      Partials.set(key, blocks[key] = compiler);
    }
  }
  for (let name in config.$partials) {
    let key = toPartialName(name);
    debug$1("[collect.$partials]", key);
    let compiler = config.$partials[name];
    Partials.set(key, blocks[key] = compiler);
  }
  await list(layouts, async (_, rel) => {
    if (isHBS.test(rel)) {
      debug$1("[collect.layouts]", rel);
      Layouts.set(rel, await compile$1(layouts, rel));
    }
  });
}
function frontmatter(content) {
  let metadata = {};
  if (content.substring(0, 3) !== "---")
    return [0, metadata];
  let match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(content);
  if (match == null)
    return [0, metadata];
  match[1].split("\n").forEach((pair) => {
    let [key, ...v] = pair.split(":");
    metadata[key.trim()] = v.join(":").trim();
  });
  return [match[0].length, metadata];
}

const views = {
	__proto__: null,
	Layouts: Layouts,
	Partials: Partials,
	collect: collect,
	frontmatter: frontmatter
};

function normalize(argv) {
  argv.cwd = path.resolve(argv.cwd);
  argv.debug = !!argv.debug;
  argv.dev = !!argv.dev;
  argv.src = path.resolve(argv.cwd, argv.src || ".");
  argv.dest = path.resolve(argv.cwd, "public");
  argv.assets = path.resolve(argv.src, "assets");
  argv.content = path.resolve(argv.src, "content");
  argv.partials = path.resolve(argv.src, "partials");
  argv.layouts = path.resolve(argv.src, "layouts");
  const { PORT, HOST } = process.env;
  argv.port = argv.port || PORT && +PORT || 3e3;
  argv.host = argv.host || HOST || "localhost";
}

const RELOAD = "/~/reload";
const clients = /* @__PURE__ */ new Set();
function reload() {
  for (let res of clients) {
    res.write("data: refresh\n\n");
  }
}
function start(argv) {
  clients.clear();
  const handler = sirv(argv.dest, {
    single: true,
    etag: true,
    dev: true
  });
  const server = http.createServer((req, res) => {
    if (req.url !== RELOAD) {
      return handler(req, res);
    }
    res.writeHead(200, {
      "connection": "keep-alive",
      "content-type": "text/event-stream",
      "cache-control": "no-cache"
    });
    res.socket.setTimeout(0);
    req.once("close", () => {
      clients.delete(res);
      res.end();
    });
    return clients.add(res);
  });
  return new Promise((res, rej) => {
    server.on("error", rej).listen(argv.port, argv.host, () => res(server));
  });
}

async function build(argv) {
  normalize(argv);
  const config = await load(argv.cwd);
  const { $site, $assets: ASSETS } = config;
  const debug$1 = argv.debug ? debug : () => {
  };
  debug$1("[build.argv]", argv);
  await rmdir(argv.dest);
  config.$assets = {
    load(filename, encoding) {
      let file = path.join(argv.assets, filename);
      assert(file, `Missing "${filename}" asset!`);
      return read(file, encoding);
    }
  };
  await collect(argv, config);
  const { Layouts } = views;
  const { dest, content } = argv;
  await list(content, async (input, rel, name) => {
    let idx = rel.lastIndexOf(".");
    let path$1 = "/" + rel.substring(0, idx);
    let output = path.join(dest, rel);
    idx = name.lastIndexOf(".");
    let ext = name.substring(idx + 1);
    let basename = name.substring(0, idx);
    let params = {};
    let isPage = /(hbs|html?)$/;
    let render;
    let layout = "", content2 = "";
    if (isPage.test(ext)) {
      content2 = await read(input, "utf8");
      let [idx2, metadata] = frontmatter(content2);
      if (idx2 > 0) {
        Object.assign(params, metadata);
        content2 = content2.substring(idx2);
      }
      if (ext === "hbs") {
        console.log('[TODO] compile "*.hbs" content');
      }
    } else if (ASSETS[ext]) {
      let loader, filename = input;
      let prev, data = new Uint8Array(await read(input));
      debug$1("[content.loader]", ext, "~> found");
      while (prev !== ext) {
        if (isPage.test(ext))
          break;
        if (loader = ASSETS[prev = ext]) {
          let result = await loader(filename, data);
          filename = result.filename;
          data = result.content;
          if (result.metadata) {
            Object.assign(params, result.metadata);
          }
        }
        ext = path.extname(filename).substring(1);
        debug$1("[content.looper]", prev, "~>", ext);
      }
      if (isPage.test(ext)) {
        content2 = typeof data === "string" ? data : new TextDecoder().decode(data);
      } else {
        return write(output, data);
      }
    } else {
      debug$1("[content.loader]", ext, "~> unknown");
      return copy(input, output);
    }
    if (typeof params.url === "string") {
      path$1 = "/" + params.url.replace(/^.?\/+/, "");
      if (/^(https?:)?\/\//.test(path$1)) {
        throw new Error("Custom `url` must be path only");
      }
    }
    path$1 = path$1.substring(1);
    if (path$1 === "index")
      path$1 = "";
    output = path.join(dest, path$1, "index.html");
    path$1 += "/";
    let $page = {
      path: path$1,
      params,
      content: content2,
      url: new URL(path$1, $site.url).href,
      summary: params.summary || "",
      title: params.title || "",
      scripts: "",
      styles: ""
    };
    let i = 0, dirs = rel.split(/[\\\/]+/g).slice(0, -1).concat("");
    if (isPage.test(ext)) {
      let j = 0, files = ["index.hbs", "html.hbs"];
      if (basename !== "index") {
        files.splice(0, 1, `${basename}.hbs`, "single.hbs");
      }
      outer:
        for (; i < dirs.length; i++) {
          for (j = 0; j < files.length; j++) {
            layout = path.join(dirs[i], files[j]);
            render = Layouts.get(layout);
            debug$1("[content.layout]", rel, "~>", layout);
            if (render)
              break outer;
          }
        }
      if (!render)
        throw new Error('Missing "html.hbs" template');
      content2 = await render({ $page, ...config });
    }
    if (!layout.endsWith("html.hbs")) {
      $page.content = content2;
      for (i = 0; i < dirs.length; i++) {
        layout = path.join(dirs[i], "html.hbs");
        render = Layouts.get(layout);
        debug$1("[content.layout]", rel, "~>", layout);
        if (render)
          break;
      }
      if (!render)
        throw new Error('Missing "html.hbs" template');
      content2 = await render({ $page, ...config });
    }
    if (argv.dev) {
      content2 += `<script>`;
      content2 += `var es = new EventSource('${RELOAD}');`;
      content2 += `es.onopen = () => console.log('[dev] live reload enabled');`;
      content2 += `es.onmessage = () => location.reload();`;
      content2 += `<\/script>`;
    }
    await write(output, content2);
  });
  if (argv.minify) {
    const exec = require("util").promisify(require("child_process").exec);
    try {
      let { stdout, stderr } = await exec("minify --version");
      if (stderr.length || stdout.length < 1)
        throw 1;
    } catch (err) {
      console.error("You must have `minify` available in your $PATH for `--minify` to work.");
      console.error("Visit ~https://github.com/tdewolff/minify~ for installation instructions.");
      return process.exit(1);
    }
    let cwd = process.cwd();
    let input = path.relative(cwd, argv.dest);
    console.log("~> compressing...", input);
    let output = path.relative(cwd, argv.cwd) || ".";
    await exec(`minify -r "${input}" -o "${output}"`);
  }
  console.log("~> DONE~!");
}

async function dev(argv) {
  argv.dev = true;
  async function rebuild() {
    reset();
    console.log("~> inside");
    Partials.clear();
    Layouts.clear();
    await build(argv);
    reload();
  }
  await build(argv);
  const flags = argv;
  const server = await start(flags);
  console.log("~> started", server.address());
  await watch([
    flags.assets,
    flags.layouts,
    flags.partials,
    flags.content
  ], rebuild);
}

const define = (c) => c;

exports.build = build;
exports.define = define;
exports.dev = dev;
