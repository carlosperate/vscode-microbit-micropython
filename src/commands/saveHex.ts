import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { hexFilename } from '../filename';
import { log } from '../log';
import { prepareHex } from './prepare';

/**
 * A hex on disk, which is the whole product in Firefox and Safari and the only
 * way to program a board until flashing lands. No board, no USB, nothing to ask
 * permission for.
 *
 * `showSaveDialog` is the one mechanism, on every host: a native panel on the
 * desktop, and VS Code's own quick-pick dialog in a browser, which writes
 * through `workspace.fs` to a workspace backed entirely by virtual providers.
 */
export async function saveHex(context: vscode.ExtensionContext): Promise<void> {
	const prepared = await prepareHex(context);
	if (!prepared) return;

	const { uri, name } = prepared.folder;
	const target = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.joinPath(uri, hexFilename(name)),
		saveLabel: 'Save Hex',
		filters: { 'micro:bit hex': ['hex'] },
	});

	// A dismissed dialog is a decision, so it passes without a word. The log still
	// says so, or nothing tells it apart from a save that broke.
	if (!target) {
		log('The save was dismissed, and nothing was written');
		return;
	}

	// A path where there is one, and the whole URI where the scheme is the clue.
	const where = target.scheme === 'file' ? target.fsPath : target.toString();

	try {
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(prepared.hex));
	} catch (error) {
		// The host's own reason stays in the log. A `FileSystemError` repeats its
		// name and the path inside `message`, which buries the part worth reading.
		log(`Could not write ${target}: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: the hex could not be written to ${where}. Try somewhere else.`);
		return;
	}

	log(`Saved to ${where}`);
	void vscode.window.showInformationMessage(`${PRODUCT}: saved ${where}. ${nextStep(target)}`);
}

/**
 * A browser workspace is virtual, so the file just written is somewhere the
 * operating system cannot see and cannot copy to a board. VS Code's own Explorer
 * download is what gets it out, and saying so is the difference between a file a
 * learner can use and one they can only look at.
 */
const nextStep = (uri: vscode.Uri) =>
	uri.scheme === 'file'
		? 'Drag it onto the MICROBIT drive to run it on the board.'
		: 'Right-click it in the Explorer to download it, then drag it onto the MICROBIT drive.';
