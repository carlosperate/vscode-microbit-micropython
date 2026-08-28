import { expect, it } from 'vitest';

import manifest from '../package.json';
import { SERIAL_MONITOR_EXTENSION } from '../src/config';

it('offers the exact Eclipse Serial Monitor extension as its install companion', () => {
	expect(manifest.extensionPack).toEqual([SERIAL_MONITOR_EXTENSION]);
});
