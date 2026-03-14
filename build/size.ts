const UNITS = ['B ', 'kB', 'MB', 'GB'];

export function size(val = 0): string {
	if (val < 1e3) return `${val} ${UNITS[0]}`;
	let exp = Math.min(Math.floor(Math.log10(val) / 3), UNITS.length - 1) || 1;
	let out = (val / Math.pow(1e3, exp)).toPrecision(3);
	let idx = out.indexOf('.');
	if (idx === -1) out += '.00';
	else if (out.length - idx - 1 !== 2) {
		out = (out + '00').substring(0, idx + 3);
	}
	return out + ' ' + UNITS[exp];
}
