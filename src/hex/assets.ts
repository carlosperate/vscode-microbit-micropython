/**
 * Reaching the MicroPython images that ship inside this extension.
 *
 * `vscode.workspace.fs` and never `fetch`. It is the one reader that works on
 * both hosts: the desktop hands out a `file:` `extensionUri`, which `fetch`
 * refuses outright, and a browser host serves the same files over http through
 * a provider `workspace.fs` can reach.
 */
import * as vscode from 'vscode';

import { log } from '../log';
import { createFirmwareCache, type BoardVersion, type Firmware } from './build';

let load: ((version: BoardVersion) => Promise<Firmware>) | undefined;

/**
 * The images, read at most once each for as long as the extension is loaded.
 * `extensionUri` comes from the caller because there is no other way to it, and
 * it is the same URI every time, so the first caller's is the only one there
 * will be.
 */
export function readFirmware(extensionUri: vscode.Uri, version: BoardVersion): Promise<Firmware> {
	load ??= createFirmwareCache((file) =>
		readAsset(vscode.Uri.joinPath(extensionUri, 'assets', 'firmware', file))
	);
	return load(version);
}

/**
 * Logs where it read from and why a read failed. Both belong here rather than in
 * the message a user sees: the URI is the whole answer on a host with no network
 * panel, and this is the only place the host's own reason survives.
 */
async function readAsset(uri: vscode.Uri): Promise<Uint8Array> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		log(`Read ${bytes.length} bytes of firmware from ${uri}`);
		return bytes;
	} catch (error) {
		log(`Could not read ${uri}: ${String(error)}`);
		throw error;
	}
}
