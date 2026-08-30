import * as vscode from 'vscode';

import { PRODUCT, SERIAL_MONITOR_EXTENSION } from '../config';
import { log } from '../log';
import { SerialMonitorError } from './provider';

const SHOW_EXTENSION = 'Show Serial Monitor Extension';

/**
 * Why no terminal opened. A missing or outdated companion is the one failure a
 * user can act on, so it gets the button that takes them to it; everything else
 * carries its own message and the output channel has the rest.
 */
export async function reportSerialFailure(error: unknown): Promise<void> {
	log(`The serial terminal could not be opened: ${String(error)}`);
	const message = error instanceof Error ? error.message : String(error);

	if (error instanceof SerialMonitorError) {
		const action = await vscode.window.showErrorMessage(`${PRODUCT}: ${message}`, SHOW_EXTENSION);
		if (action === SHOW_EXTENSION) {
			await vscode.commands.executeCommand('workbench.extensions.search', `@id:${SERIAL_MONITOR_EXTENSION}`);
		}
		return;
	}

	void vscode.window.showErrorMessage(`${PRODUCT}: the serial terminal could not be opened. ${message}`);
}
