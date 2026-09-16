import type * as vscode from 'vscode';

import { log } from '../log';
import type { ManagerLink } from '../manager/link';
import { prepareHex, projectClause } from './prepare';

/**
 * A hex on disk, which is the whole product wherever a board cannot be reached:
 * Firefox, Safari, a desktop with nothing plugged in. Built here for every
 * board, since nothing says which one it will land on, and saved by the
 * manager, which owns the one copy of the naming rules and the dialog.
 */
export const saveHex =
	(manager: ManagerLink) =>
	async (context: vscode.ExtensionContext): Promise<void> => {
		const api = manager.api();
		if (!api) return;

		const prepared = await prepareHex(context);
		if (!prepared) return;

		// The manager reports the save, or its dismissal, in its own words.
		if (await api.saveHex(prepared.hex, prepared.folder.name)) {
			log(`Saved ${prepared.files.length} file(s)${projectClause(prepared)} as a hex for every micro:bit`);
		}
	};
