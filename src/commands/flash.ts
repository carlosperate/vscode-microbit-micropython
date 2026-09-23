import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { log } from '../log';
import type { ManagerLink } from '../manager/link';
import { buildHex, fitsSomeBoard, listNames, prepareFiles, projectClause } from './prepare';

/**
 * One flash at a time. Set before the first await: most of what this guards is
 * connecting and building, and the first thing a second Flash meets is often an
 * open device chooser.
 */
let running = false;

export const flash =
	(manager: ManagerLink) =>
	async (context: vscode.ExtensionContext): Promise<void> => {
		if (running) {
			void vscode.window.showInformationMessage(`${PRODUCT}: Flash is already running.`);
			return;
		}

		running = true;
		try {
			await buildAndSend(context, manager);
		} finally {
			running = false;
		}
	};

/**
 * Select the files, ask which board, build for it, hand the bytes over. The
 * order is the point: a MicroPython hex is built from a V1 or a V2 image, so the
 * version has to be known before the build starts, and the same board goes back
 * as `expect` so one swapped during a slow build is refused, not flashed wrongly.
 */
async function buildAndSend(context: vscode.ExtensionContext, manager: ManagerLink): Promise<void> {
	const api = manager.api();
	if (!api) return;

	// Before connecting: a folder with nothing to send must not cost a device chooser.
	const files = await prepareFiles(context);
	if (!files) return;

	// Nor must files that no micro:bit could hold.
	if (!(await fitsSomeBoard(context, files))) return;

	// Undefined has been explained by the manager, or was a cancellation needing none.
	const board = await api.connect();
	if (!board) return;

	const prepared = await buildHex(context, files, board.version);
	if (!prepared) return;

	if (!(await api.flashHex(prepared.hex, { expect: board }))) return;

	log(`Flashed ${prepared.files.length} file(s) to a micro:bit ${board.version}`);
	void vscode.window.showInformationMessage(
		`${PRODUCT}: flashing ${prepared.files.length} file(s)${projectClause(prepared)} to the micro:bit, ` +
			`${listNames(prepared.files)}.`
	);
}
