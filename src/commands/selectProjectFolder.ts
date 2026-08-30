import * as vscode from 'vscode';

import { PRODUCT, SECTION, SETTINGS } from '../config';
import { relativeTo } from '../files/project';
import { chooseWorkspaceFolder } from '../files/workspace';
import { log } from '../log';

/**
 * Stores the project folder picked from a folder dialog, which answers with an
 * absolute URI that has to be inside a workspace folder.
 */
export async function selectProjectFolder(): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		void vscode.window.showWarningMessage(`${PRODUCT}: open a folder first, there is no project to point at.`);
		return;
	}

	// Both the dialog and resource-scoped setting can reject through their providers.
	try {
		const chosen = await askForFolder();
		// Dismissing the dialog changes nothing and says nothing.
		if (!chosen) return;

		const workspace = vscode.workspace.getWorkspaceFolder(chosen);
		const path = workspace && relativeTo(workspace.uri.path, chosen.path);
		if (!workspace || path === undefined) {
			void vscode.window.showErrorMessage(
				`${PRODUCT}: the project folder has to be inside the workspace, and ${chosen.path} is not.`
			);
			return;
		}

		// Workspace-folder scope keeps the setting shareable without following the user.
		await vscode.workspace
			.getConfiguration(SECTION, workspace.uri)
			.update(SETTINGS.projectFolder, path, vscode.ConfigurationTarget.WorkspaceFolder);

		log(`${SETTINGS.projectFolder} set to "${path}" for ${workspace.uri}`);
		void vscode.window.showInformationMessage(
			path
				? `${PRODUCT}: ${path}/ is the micro:bit project folder. Only the files in it go on the board.`
				: `${PRODUCT}: the whole of ${workspace.name} is the micro:bit project folder again.`
		);
	} catch (error) {
		log(`Could not set ${SETTINGS.projectFolder}: ${String(error)}`);
		void vscode.window.showErrorMessage(
			`${PRODUCT}: the project folder could not be saved, see the output for why.`
		);
	}
}

/**
 * VS Code's own folder picker, which browses lazily rather than needing every
 * folder listed up front.
 *
 * **`defaultUri` decides which implementation runs**, not merely where the
 * dialog opens. On the web, `BrowserFileDialogService` sends any scheme other
 * than `file:` to the same quick-pick dialog Save Hex uses; hand it a `file:`
 * URI, or none at all, and it reaches for the File System Access API instead,
 * which picks from the real disk and answers browsers that lack it with an
 * unsupported-browser warning rather than a dialog.
 */
async function askForFolder(): Promise<vscode.Uri | undefined> {
	const workspace = await chooseWorkspaceFolder();
	if (!workspace) return undefined;

	const picked = await vscode.window.showOpenDialog({
		defaultUri: workspace.uri,
		canSelectFolders: true,
		canSelectFiles: false,
		canSelectMany: false,
		openLabel: 'Set Project Folder',
		title: `Which folder holds the ${PRODUCT} project?`,
	});
	return picked?.[0];
}
