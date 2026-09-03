import * as vscode from 'vscode';

import { DEVICE_VIEW_ID } from '../config';

/**
 * The device section is welcome content alone, written in the manifest. VS Code
 * shows it only over a tree that has a provider and no children; with no
 * provider the view says so instead, and the content never appears.
 */
export function createDeviceView(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider<vscode.TreeItem>(DEVICE_VIEW_ID, {
			getChildren: () => [],
			getTreeItem: (item) => item,
		})
	);
}
