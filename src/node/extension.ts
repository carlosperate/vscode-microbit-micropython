/**
 * The desktop entry point, and the one the web does not use. There is no WebUSB
 * here and no way to reach one: the workbench command that bridges the device
 * chooser is registered only by the web workbench, so a board is reached through
 * the drive it mounts instead.
 */
import * as vscode from 'vscode';

import { activateHost, type ExtensionApi } from '../activate';
import { saveHex } from '../commands/saveHex';
import { selectProjectFolder } from '../commands/selectProjectFolder';
import { COMMANDS, PRODUCT } from '../config';
import { flashToDrive } from './flash';
import { openTerminal } from './terminal';

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	return activateHost(context, {
		entry: 'node',
		commands: {
			[COMMANDS.flash]: flashToDrive,
			[COMMANDS.saveHex]: saveHex,
			[COMMANDS.selectProjectFolder]: selectProjectFolder,
			[COMMANDS.openTerminal]: openTerminal,
			// Hidden from the palette and the menu here, but every contributed command must resolve.
			[COMMANDS.connect]: pairingIsNotNeeded,
			[COMMANDS.disconnect]: pairingIsNotNeeded,
		},
		start: (context) => context.subscriptions.push(createStatusBar()),
	});
}

async function pairingIsNotNeeded(): Promise<void> {
	void vscode.window.showInformationMessage(
		`${PRODUCT}: desktop VS Code does not need to connect to a micro:bit first. Just run Flash and your ` +
			'program goes straight to the board.'
	);
}

/** No live connection to report, so the item is only the way in to the menu. */
function createStatusBar(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.name = PRODUCT;
	item.command = COMMANDS.showMenu;
	item.text = '$(plug) micro:bit';
	item.tooltip = `${PRODUCT}: what to do with a micro:bit`;
	item.show();
	return item;
}
