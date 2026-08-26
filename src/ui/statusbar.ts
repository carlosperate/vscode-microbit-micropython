import * as vscode from 'vscode';

import { COMMANDS, PRODUCT } from '../config';

/** The always-visible entry point for connecting a board. */
export function createStatusBar(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.name = PRODUCT;
	item.text = `$(plug) ${PRODUCT}`;
	item.tooltip = `${PRODUCT}: no board connected`;
	item.command = COMMANDS.connect;
	item.show();
	return item;
}
