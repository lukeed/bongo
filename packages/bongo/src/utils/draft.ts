import type { Template } from 'bongo';

// `2024-05-01`, `2024-05-01T09:30`, or `2024-05-01 09:30:15.250`, with an optional `Z` or offset
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * The moment that a frontmatter `date` names, in ms since the epoch. A date, or a time without an offset, is in UTC, as `$utils.date` reads it.
 * A value that is not an ISO date names no moment.
 * @example moment('2024-05-01T09:30+02:00') //=> 1714548600000
 */
export function moment(value: unknown): number | undefined {
	if (typeof value !== 'string') return;
	let match = ISO.exec(value.trim());
	if (!match) return;
	let [, day, time = '00:00', zone = 'Z'] = match;
	if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0, 3) + ':' + zone.slice(3);
	let at = Date.parse(`${day}T${time}${zone.toUpperCase()}`);
	return Number.isNaN(at) ? undefined : at;
}

/**
 * Whether a page with these params is a draft at `now`: it says `draft: true`, or its `date` is after `now`, unless it says `draft: false`.
 * @example draft({ date: '2999-01-01' }, Date.now()) //=> true
 */
export function draft(params: Template.Params, now: number): boolean {
	if (params.draft === true) return true;
	if (params.draft === false) return false;
	let at = moment(params.date);
	return at !== undefined && at > now;
}
