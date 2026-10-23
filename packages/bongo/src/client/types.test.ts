import { expect, test } from 'bun:test';

import type * as dts from '../../client';
import type * as src from './index';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// `bunx tsc -p .` fails when client.d.ts and the source disagree
test('client.d.ts declares what src/client exports', () => {
	let same: [
		Same<dts.ClientOptions, src.ClientOptions>,
		Same<dts.BongoEvent, src.BongoEvent>,
		Same<dts.BongoEventDetails, src.BongoEventDetails>,
		Same<typeof dts.client, typeof src.client>,
		Same<typeof dts.navigate, typeof src.navigate>,
		Same<typeof dts.on, typeof src.on>,
		Same<typeof dts.off, typeof src.off>,
	] = [true, true, true, true, true, true, true];
	expect(same).not.toContain(false);
});
