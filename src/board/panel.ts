import * as vscode from 'vscode';

import { BOARD_VIEW_ID } from '../config';

/**
 * The buttons are welcome content alone, written in the manifest. VS Code shows
 * it only over a tree that has a provider and no children; with no provider the
 * view says so instead, and the content never appears.
 */
export function createBoardPanel(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider<vscode.TreeItem>(BOARD_VIEW_ID, {
			getChildren: () => [],
			getTreeItem: (item) => item,
		})
	);
}
