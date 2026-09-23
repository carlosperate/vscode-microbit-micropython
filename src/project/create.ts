import * as vscode from 'vscode';

import { folderName, openProject } from '../commands/prepare';
import { PRODUCT } from '../config';
import { log } from '../log';
import { MAIN, TEMPLATE } from './template';

/**
 * Writes a starting `main.py` and opens it. It lands in the configured project
 * folder rather than the workspace root, because that is the only folder Flash
 * reads, and an existing file is opened untouched: overwriting somebody's
 * program is not a mistake they can undo.
 */
export async function createProject(): Promise<void> {
	const opened = await openProject('there is nowhere to create a project');
	if (!opened) return;
	const { project } = opened;

	const main = vscode.Uri.joinPath(project.uri, MAIN);
	let present: boolean;
	try {
		present = await exists(main);
	} catch (error) {
		void vscode.window.showErrorMessage(
			`${PRODUCT}: could not read ${main.path}, so nothing was written. ${message(error)}`
		);
		return;
	}

	if (present) {
		void vscode.window.showInformationMessage(`${PRODUCT}: ${folderName(project.path)} already has a ${MAIN}.`);
	} else {
		try {
			await vscode.workspace.fs.writeFile(main, new TextEncoder().encode(TEMPLATE));
		} catch (error) {
			void vscode.window.showErrorMessage(`${PRODUCT}: could not write ${main.path}. ${message(error)}`);
			return;
		}
		log(`Created ${main.toString()}`);
	}

	await vscode.window.showTextDocument(main);
}

/** Only "not there" means it is safe to write; anything else could be a file we cannot see. */
async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
		throw error;
	}
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
