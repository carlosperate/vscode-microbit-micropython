/**
 * Reaching the simulator files that ship inside this extension, through
 * `vscode.workspace.fs` and never `fetch`: the desktop hands out a `file:`
 * `extensionUri`, which `fetch` refuses.
 */
import * as vscode from 'vscode';

import { log } from '../log';
import { RUNTIME_FILES } from './protocol';

export const simulatorAssets = (extensionUri: vscode.Uri): vscode.Uri =>
	vscode.Uri.joinPath(extensionUri, 'assets', 'simulator');

/**
 * The stat catches a missing file before a document is built, on desktop. On web
 * it answers for any URI, and the shell's own fetch of the same list is the check.
 */
export async function readSimulatorHtml(extensionUri: vscode.Uri): Promise<string> {
	const assets = simulatorAssets(extensionUri);
	for (const file of RUNTIME_FILES) {
		const uri = vscode.Uri.joinPath(assets, ...file.split('/'));
		try {
			await vscode.workspace.fs.stat(uri);
		} catch (error) {
			log(`Could not read ${uri}: ${String(error)}`);
			throw new Error(`${file} is missing from the extension`);
		}
	}
	const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets, 'simulator.html'));
	return new TextDecoder().decode(bytes);
}
