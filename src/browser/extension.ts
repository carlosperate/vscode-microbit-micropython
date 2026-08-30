/**
 * The web entry point, and the one desktop does not use. A board is reached
 * over WebUSB here, which needs the workbench to bridge a device chooser that
 * only the web workbench registers.
 */
import * as vscode from 'vscode';

import { activateHost, type ExtensionApi } from '../activate';
import { connect, disconnect } from '../commands/board';
import { flash } from '../commands/flash';
import { openTerminal } from '../commands/openTerminal';
import { saveHex } from '../commands/saveHex';
import { selectProjectFolder } from '../commands/selectProjectFolder';
import { COMMANDS } from '../config';
import { boardAttached, createBoard, shutdownBoard } from '../usb/connection';

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	return activateHost(context, {
		entry: 'browser',
		commands: {
			[COMMANDS.flash]: flash,
			[COMMANDS.saveHex]: saveHex,
			[COMMANDS.selectProjectFolder]: selectProjectFolder,
			[COMMANDS.connect]: connect,
			[COMMANDS.disconnect]: disconnect,
			[COMMANDS.openTerminal]: openTerminal,
		},
		start: createBoard,
		boardAttached,
	});
}

/**
 * Awaited by VS Code, which is why the board is handed back here rather than
 * from a subscription: `dispose()` is synchronous and cannot see an asynchronous
 * disconnect through before the worker goes away.
 */
export function deactivate(): Promise<void> {
	return shutdownBoard();
}
