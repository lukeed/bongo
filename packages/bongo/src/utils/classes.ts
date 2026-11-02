// A `class` attribute, quoted or bare, wherever it is; a match in a script or a comment only adds a name that no page needs.
const ATTR = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * The class names in the `class` attributes of `html`, with their entities decoded, sorted and once each.
 * @example classes.scan('<p class="a b"><i class=\'b &amp;c\'>') //=> ['&c', 'a', 'b']
 */
export function scan(html: string): string[] {
	// a page repeats a few values many times, as highlighted code does, so each value splits once
	let values: Set<string> = new Set();
	let match: RegExpExecArray | null;
	ATTR.lastIndex = 0;
	while ((match = ATTR.exec(html))) values.add(match[1] ?? match[2] ?? match[3]);

	let out: Set<string> = new Set();
	for (let value of values) {
		if (value.includes('&')) value = value.replace(ENTITY, (text, dec?: string, hex?: string, name?: string) => {
			if (name) return NAMED[name.toLowerCase()];
			let code = dec ? Number(dec) : parseInt(hex!, 16);
			return code > 0x10ffff ? text : String.fromCodePoint(code);
		});
		for (let name of value.split(/\s+/)) if (name) out.add(name);
	}
	return [...out].sort();
}
