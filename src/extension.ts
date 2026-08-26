import * as vscode from 'vscode';

import { flash } from './commands/flash';
import { saveHex } from './commands/saveHex';
import { selectProjectFolder } from './commands/selectProjectFolder';
import { COMMANDS, PRODUCT, type CommandId } from './config';
import { createLog, log } from './log';
import { createStatusBar } from './ui/statusbar';

/**
 * Commands with an implementation. The rest answer with the stub below.
 *
 * Keyed on `CommandId` rather than `string`, so a mistyped id is a compile
 * error. Spelled wrong it would simply never match, leaving the command to
 * answer "not implemented yet" forever, and nothing else would notice: the
 * integration check only asserts that every contributed id is registered.
 */
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

	// Registered from our own list of ids, not from the manifest, so the tests'
	// manifest-versus-code comparison stays a real check. The titles do come from
	// the manifest: they are user-facing prose, and a second copy of them here
	// would drift the moment one is reworded.
	const titles = contributedTitles(context);
	for (const id of Object.values(COMMANDS)) {
		const implementation = IMPLEMENTED[id];
		context.subscriptions.push(
			// Forwarded, not dropped: a command on a context menu is handed the
			// resource that was clicked, and for one of these that is the answer.
			vscode.commands.registerCommand(id, async (...args: unknown[]) => {
				log(`Running ${id}`);
				if (implementation) return implementation(context, ...args);
				void vscode.window.showInformationMessage(`${PRODUCT}: ${titles.get(id) ?? id} is not implemented yet.`);
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
