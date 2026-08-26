import * as vscode from 'vscode';

import { flash } from './commands/flash';
import { saveHex } from './commands/saveHex';
import { selectProjectFolder } from './commands/selectProjectFolder';
import { COMMANDS, PRODUCT, type CommandId } from './config';
import { createLog, log } from './log';
import { createStatusBar } from './ui/statusbar';

/** Implemented commands, keyed by the typed ids also registered below. */
const IMPLEMENTED: Partial<
	Record<CommandId, (context: vscode.ExtensionContext, ...args: unknown[]) => Promise<void>>
> = {
	[COMMANDS.flash]: flash,
	[COMMANDS.saveHex]: saveHex,
	[COMMANDS.selectProjectFolder]: selectProjectFolder,
};

export function activate(context: vscode.ExtensionContext): void {
	createLog(context);
	log('Extension activated');

	context.subscriptions.push(createStatusBar());

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

export function deactivate(): void {}

function contributedTitles(context: vscode.ExtensionContext): Map<string, string> {
	const contributed: { command: string; title: string }[] =
		context.extension.packageJSON?.contributes?.commands ?? [];
	return new Map(contributed.map((entry) => [entry.command, entry.title]));
}
