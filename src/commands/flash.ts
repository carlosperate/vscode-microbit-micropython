import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { prepareHex } from './prepare';

/**
 * Flash cannot write to a board yet, so it builds the hex it would send and
 * says so. Everything up to the moment bytes leave the machine is real.
 */
export async function flash(context: vscode.ExtensionContext): Promise<void> {
	const prepared = await prepareHex(context);
	if (!prepared) return;

	const names = prepared.files.map((file) => file.name).join(', ');
	void vscode.window.showInformationMessage(
		`${PRODUCT}: built a hex from ${prepared.files.length} file(s) (${names}), using ${prepared.used} bytes of ` +
			`the ${prepared.available} a hex that runs on every micro:bit has room for. ` +
			'Writing to a board is not implemented yet.'
	);
}
