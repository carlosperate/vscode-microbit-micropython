import * as vscode from 'vscode';

import { COMMANDS, PRODUCT } from '../config';

/**
 * The extension's home in the status bar. It exists from activation onwards,
 * before there is any board to talk about, because it is also where a user finds
 * out the extension loaded at all. Until it can report a board it says what it
 * is and offers the one action a user would look for.
 */
export function createStatusBar(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	// `name` is what the status bar's own right-click menu lists, so it carries the
	// full product name. `text` stays short: board state gets appended to it.
	item.name = PRODUCT;
	item.text = '$(plug) micro:bit';
	item.tooltip = 'No micro:bit connected';
	item.command = COMMANDS.connect;
	item.show();
	return item;
}
