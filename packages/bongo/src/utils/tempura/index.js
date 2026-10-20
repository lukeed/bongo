// TODO: blocks.setup hook
// TODO? add `#expr` for js stmt/logic
const ESCAPE = /[&"<]/g, CHARS = {
	'"': '&quot;',
	'&': '&amp;',
	'<': '&lt;',
};

const ENDLINES = /[\r\n]+$/g;
const VAR = /(?:^|[-*+^|%/&=\s])([a-zA-Z$_][\w$]*)(?:(?=$|[-*+^|%/&=\s]))/g;
const NAME = /[a-zA-Z$_][^\s=]*/y;

function space(char) {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function quote(src, i) {
	for (let q = src[i++]; i < src.length; i++) {
		if (src[i] === '\\') i++;
		else if (src[i] === q) return i + 1;
	}
	return -1;
}

// The next {{ … }} or {{{ … }}} from `from`; it closes outside quotes and nested braces, except in a {{! comment }}.
function tag(src, from) {
	let index = src.indexOf('{{', from);
	if (index === -1) return;
	let raw = src[index + 2] === '{';
	let start = index + (raw ? 3 : 2);
	let end = raw ? '}}}' : '}}';
	let note = /^\s*!/.test(src.substring(start, start + 64));
	for (let i = start, depth = 0; i < src.length; i++) {
		let char = src[i];
		if (!note && (char === '"' || char === "'" || char === '`')) {
			let next = quote(src, i);
			if (next !== -1) i = next - 1;
		} else if (!note && char === '{') {
			depth++;
		} else if (!note && char === '}' && depth > 0) {
			depth--;
		} else if (src.startsWith(end, i)) {
			return { index, raw, text: src.substring(index, i + end.length), inner: src.substring(start, i) };
		}
	}
}

function group(src, i) {
	for (let depth = 0; i < src.length; i++) {
		let char = src[i];
		if (char === '"' || char === "'" || char === '`') {
			i = quote(src, i) - 1;
			if (i < 0) return -1;
		} else if (char === '(' || char === '{' || char === '[') {
			depth++;
		} else if ((char === ')' || char === '}' || char === ']') && --depth === 0) {
			return i + 1;
		}
	}
	return -1;
}

// `a="x" b=1 c=(x === y)` -> ['a:"x"', 'b:1', 'c:(x === y)']
function args(action, src) {
	let out = [], i = 0, start, name, end, char;
	for (;;) {
		while (space(src[i])) i++;
		if (i >= src.length) return out;
		start = i;
		NAME.lastIndex = i;
		name = NAME.exec(src);
		if (!name) break;
		i = NAME.lastIndex;
		while (space(src[i])) i++;
		if (src[i++] !== '=') break;
		while (space(src[i])) i++;
		char = src[i];
		if (char === '"' || char === "'" || char === '`') end = quote(src, i);
		else if (char === '(' || char === '{' || char === '[') end = group(src, i);
		else for (end = i; end < src.length && !space(src[end]);) end++;
		if (end <= i) break;
		out.push(name[0] + ':' + src.substring(i, end));
		i = end;
	}
	throw new Error(`Cannot read the arguments of "${action}": ${JSON.stringify(src.substring(start).trim())}`);
}

// $$1 = escape()
// $$2 = extra blocks
// $$3 = template values
function gen(input, options) {
	options = options || {};

	let char, num, action, tmp;
	let last = 0;
	let wip='', txt='', match, inner;

	let extra=options.blocks||{}, stack=[];
	let initials = new Set(options.props||[]);

	function close() {
		if (wip.length > 0) {
			txt += (txt ? '$$x+=' : '=') + '`' + wip + '`;';
		} else if (txt.length === 0) {
			txt = '="";'
		}
		wip = '';
	}

	while (match = tag(input, last)) {
		wip += input.substring(last, match.index).replace(ENDLINES, '');
		last = match.index + match.text.length;

		inner = match.inner.trim();
		char = inner.charAt(0);

		if (char === '!') {
			// comment, continue
		} else if (char === '#') {
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
				// Per-depth accumulator + index vars so nested `#each` doesn't
				// clobber the outer loop's `$$a` / `i`.
				// NOTE: the bare `{{#each items}}…{{/each}}` form (no `as (...)`)
				// used to leak an implicit `i` into the body. It now emits
				// `$$i` / `$$i1` / `$$i2` instead — undocumented, intentionally
				// dropped; use `{{#each items as (item, i)}}…{{/each}}` to name
				// an explicit index variable.
				num = inner.indexOf(' as ');
				let depth = stack.reduce((n, s) => s === 'each' ? n + 1 : n, 0);
				let acc = `$$a${depth || ''}`;
				let ii = `$$i${depth || ''}`;
				stack.push(action);
				if (!~num) {
					txt += `for(var ${ii}=0,${acc}=${inner};${ii}<${acc}.length;${ii}++){`;
				} else {
					tmp = inner.substring(0, num).trim();
					inner = inner.substring(num + 4).trim();
					let [item, idx=ii] = inner.replace(/[()\s]/g, '').split(','); // (item, idx?)
					txt += `for(var ${idx}=0,${item},${acc}=${tmp};${idx}<${acc}.length;${idx}++){${item}=${acc}[${idx}];`;
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
					// parse arguments, `defer=true` -> `{ defer: true }`
					tmp = args(action, inner);
					inner = tmp.length ? '{' + tmp.join() + '}' : '';
				}
				inner = inner || '{}';
				tmp = options.async ? 'await ' : '';
				if (extra[action].setup) {
					// TODO: try / catch ?
					let json = Function('return ' + inner)();
					extra[action].setup(json);
				}
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
			if (match.raw) wip += '${' + inner + '}'; // {{{ raw }}}
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

	tmp = initials.size ? `{${ [...initials].join() }}=$$3,$$x` : ' $$x';
	return `var${tmp + txt}return $$x`;
}

export function esc(value) {
	value = (value == null) ? '' : '' + value;
	let last=ESCAPE.lastIndex=0, tmp=0, out='';
	while (ESCAPE.test(value)) {
		tmp = ESCAPE.lastIndex - 1;
		out += value.substring(last, tmp) + CHARS[value[tmp]];
		last = tmp + 1;
	}
	return out + value.substring(last);
}

export function compile(input, options={}) {
	let render = new (options.async ? (async()=>{}).constructor : Function)(
		'$$1', '$$2', '$$3', gen(input, options)
	);
	let escape = options.escape || esc;
	return (data, blocks) => render(escape, blocks || options.blocks, data);
}

export function transform(input, options={}) {
	return (
		options.format === 'cjs'
		? 'var $$1=require("tempura").esc;module.exports='
		: 'import{esc as $$1}from"tempura";export default '
	) + (
		options.async ? 'async ' : ''
	) + 'function($$3,$$2){'+gen(input, options)+'}';
}
