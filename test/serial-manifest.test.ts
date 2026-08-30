import { expect, it } from 'vitest';

import manifest from '../package.json';
import { SERIAL_MONITOR_EXTENSION } from '../src/config';

const MICROPYTHON_LSP_EXTENSION = 'carlosperate.micropython-lsp';

it('offers the exact extension-pack companions', () => {
	expect(manifest.extensionPack).toEqual([SERIAL_MONITOR_EXTENSION, MICROPYTHON_LSP_EXTENSION]);
});
