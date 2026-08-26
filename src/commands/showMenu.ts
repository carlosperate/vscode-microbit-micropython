import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { menuCommands, type Contributed } from '../ui/menu';
import { boardAttached, usbAvailable } from '../usb/connection';

/**
 * What the status bar item opens: this extension's palette entries, in one
 * place a learner can find without knowing the palette exists.
 *
 * The titles come from the manifest at runtime, so the menu and the palette
 * cannot drift as commands are added.
 */
export async function showMenu(context: vscode.ExtensionContext): Promise<void> {
	const contributed: Contributed[] = context.extension.packageJSON?.contributes?.commands ?? [];
	// Both asked for here, on the way to opening the menu, so what it lists is
	// what is true now rather than what was true when something last changed.
	const entries = menuCommands(contributed, { usb: await usbAvailable(), connected: boardAttached() });

	const picked = await vscode.window.showQuickPick(
		entries.map((entry) => ({ label: entry.title, command: entry.command })),
		{ title: PRODUCT, placeHolder: 'What would you like to do with the micro:bit?' }
	);
	if (!picked) return;

	await vscode.commands.executeCommand(picked.command);
}
