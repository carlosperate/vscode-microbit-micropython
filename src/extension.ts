import * as vscode from 'vscode';

import { connect, disconnect } from './commands/board';
import { flash } from './commands/flash';
import { openTerminal } from './commands/openTerminal';
import { saveHex } from './commands/saveHex';
import { selectProjectFolder } from './commands/selectProjectFolder';
import { showMenu } from './commands/showMenu';
import { COMMANDS, PRODUCT, type CommandId } from './config';
import { createLog, log } from './log';
import { createSerialMonitor } from './serial/eclipse';
import { createBoard, shutdownBoard } from './usb/connection';

/** Implemented commands, keyed by the typed ids also registered below. */
const IMPLEMENTED: Partial<
	Record<CommandId, (context: vscode.ExtensionContext, ...args: unknown[]) => Promise<void>>
> = {
	[COMMANDS.flash]: flash,
	[COMMANDS.saveHex]: saveHex,
	[COMMANDS.selectProjectFolder]: selectProjectFolder,
	[COMMANDS.connect]: connect,
	[COMMANDS.disconnect]: disconnect,
	[COMMANDS.openTerminal]: openTerminal,
	[COMMANDS.showMenu]: showMenu,
};

export function activate(context: vscode.ExtensionContext): void {
	createLog(context);
	log('Extension activated');

	createSerialMonitor(context);
	createBoard(context);

	// Manifest titles keep stub notifications in sync with the command palette.
	const titles = contributedTitles(context);
	for (const id of Object.values(COMMANDS)) {
		const implementation = IMPLEMENTED[id];
		context.subscriptions.push(
			// Context-menu commands need the clicked resource forwarded intact.
			vscode.commands.registerCommand(id, async (...args: unknown[]) => {
				log(`Running ${id}`);
				try {
					if (implementation) return await implementation(context, ...args);
					void vscode.window.showInformationMessage(
						`${PRODUCT}: ${titles.get(id) ?? id} is not implemented yet.`
					);
				} catch (error) {
					// Rethrown: anything reaching here is a defect, and should stay loud.
					log(`${id} failed: ${String(error)}`);
					throw error;
				}
			})
		);
	}
}

/**
 * Awaited by VS Code, which is why the board is handed back here rather than
 * from a subscription: `dispose()` is synchronous and cannot see an asynchronous
 * disconnect through before the worker goes away.
 */
export function deactivate(): Promise<void> {
	return shutdownBoard();
}

function contributedTitles(context: vscode.ExtensionContext): Map<string, string> {
	const contributed: { command: string; title: string }[] =
		context.extension.packageJSON?.contributes?.commands ?? [];
	return new Map(contributed.map((entry) => [entry.command, entry.title]));
}
