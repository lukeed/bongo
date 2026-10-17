import { describe, expect, test } from 'bun:test';

import { draft, moment } from './draft';

describe('moment', () => {
	test('reads a date or a time without an offset in UTC', () => {
		expect(moment('2024-05-01')).toBe(Date.UTC(2024, 4, 1));
		expect(moment('2024-05-01T09:30')).toBe(Date.UTC(2024, 4, 1, 9, 30));
		expect(moment('2024-05-01 09:30:15')).toBe(Date.UTC(2024, 4, 1, 9, 30, 15));
		expect(moment('2024-05-01T09:30:15.250')).toBe(Date.UTC(2024, 4, 1, 9, 30, 15, 250));
	});

	test('reads an offset', () => {
		expect(moment('2024-05-01T09:30Z')).toBe(Date.UTC(2024, 4, 1, 9, 30));
		expect(moment('2024-05-01T09:30+02:00')).toBe(Date.UTC(2024, 4, 1, 7, 30));
		expect(moment('2024-05-01T09:30-0500')).toBe(Date.UTC(2024, 4, 1, 14, 30));
	});

	test('names no moment for anything that is not an ISO date', () => {
		for (let value of ['May 1, 2024', 'TBD', '2024', '', '2024-05-01T25:00', 2024, true, null, undefined]) {
			expect(moment(value)).toBeUndefined();
		}
	});
});

describe('draft', () => {
	let now = Date.UTC(2026, 9, 17, 12);

	test('is a page that says draft: true, whatever its date', () => {
		expect(draft({ draft: true }, now)).toBe(true);
		expect(draft({ draft: true, date: '2020-01-01' }, now)).toBe(true);
	});

	test('is a page whose date is after now', () => {
		expect(draft({ date: '2026-10-18' }, now)).toBe(true);
		expect(draft({ date: '2026-10-17T12:00:01Z' }, now)).toBe(true);
		expect(draft({ date: '2026-10-17T12:00Z' }, now)).toBe(false);
		expect(draft({ date: '2026-10-17' }, now)).toBe(false);
	});

	test('is not a page that says draft: false, whatever its date', () => {
		expect(draft({ draft: false, date: '2999-01-01' }, now)).toBe(false);
	});

	test('is not a page without a date, or with a date that names no moment', () => {
		expect(draft({}, now)).toBe(false);
		expect(draft({ date: 'TBD' }, now)).toBe(false);
		expect(draft({ draft: 'yes', date: 'soon' }, now)).toBe(false);
	});
});
