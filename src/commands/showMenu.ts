import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { menuCommands, type Contributed } from '../ui/menu';

/**
 * What the status bar item opens: this extension's palette entries, in one
 * place a learner can find without knowing the palette exists.
 *
 * The titles come from the manifest at runtime, so the menu and the palette
 * cannot drift as commands are added. `connected` is undefined where no board
 * can be authorised at all, and Connect and Disconnect then have no meaning.
 */
export async function showMenu(context: vscode.ExtensionContext, connected: boolean | undefined): Promise<void> {
	const contributed: Contributed[] = context.extension.packageJSON?.contributes?.commands ?? [];
	const entries = menuCommands(contributed, connected);

	const picked = await vscode.window.showQuickPick(
		entries.map((entry) => ({ label: entry.title, command: entry.command })),
		{ title: PRODUCT, placeHolder: 'What would you like to do with the micro:bit?' }
	);
	if (!picked) return;

	await vscode.commands.executeCommand(picked.command);
}
