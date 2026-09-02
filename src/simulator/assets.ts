/**
 * Reaching the simulator files that ship inside this extension.
 *
 * `vscode.workspace.fs` and never `fetch`, for the same reason `src/hex/assets.ts`
 * uses it: the desktop hands out a `file:` `extensionUri`, which `fetch` refuses.
 */
import * as vscode from 'vscode';

import { log } from '../log';

/** Everything the document needs at runtime, checked before one is built. */
const FILES = ['simulator.html', 'build/firmware.js', 'build/simulator.js', 'build/firmware.wasm'];

export const simulatorAssets = (extensionUri: vscode.Uri): vscode.Uri =>
	vscode.Uri.joinPath(extensionUri, 'assets', 'simulator');

/**
 * Upstream posts `ready` before anything touches the WebAssembly, so a missing
 * file would otherwise show up as a board that boots and fails on the first run.
 */
export async function readSimulatorHtml(extensionUri: vscode.Uri): Promise<string> {
	const assets = simulatorAssets(extensionUri);
	for (const file of FILES) {
		const uri = vscode.Uri.joinPath(assets, ...file.split('/'));
		try {
			// stat rather than read: the wasm alone is 1.2 MB and nothing here needs it.
			await vscode.workspace.fs.stat(uri);
		} catch (error) {
			log(`Could not read ${uri}: ${String(error)}`);
			throw new Error(`${file} is missing from the extension`);
		}
	}
	const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets, 'simulator.html'));
	return new TextDecoder().decode(bytes);
}
