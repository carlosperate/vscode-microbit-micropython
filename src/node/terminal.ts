import * as vscode from 'vscode';

import { openNativeSerial } from '../serial/eclipse';
import { reportSerialFailure } from '../serial/failure';

/**
 * The serial terminal, which the Eclipse companion owns here exactly as it does
 * on the web. Port enumeration, baud selection and the pseudoterminal are all
 * its; nothing here opens a port, and nothing here depends on a native module.
 */
export async function openTerminal(): Promise<void> {
	try {
		await openNativeSerial(await vscode.commands.getCommands(true));
	} catch (error) {
		await reportSerialFailure(error);
	}
}
