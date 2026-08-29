import type { FlashDataSource } from '@microbit/microbit-connection';
import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { log } from '../log';
import { createProgress } from '../ui/progress';
import {
	boardSerialNumber,
	boardVersion,
	connectBoard,
	flashBoard,
	withSerialWritesBlocked,
} from '../usb/connection';
import { hasSomethingToBuild, prepareHex, projectClause } from './prepare';

/**
 * One flash at a time. Set before the first await, because two writers on one
 * interface is a corrupted device and a double click is easy to make.
 */
let copying = false;

export async function flash(context: vscode.ExtensionContext): Promise<void> {
	// Not "already copying": most of what this guards is connecting and building,
	// and the first thing a second Flash meets is often an open device chooser.
	if (copying) {
		void vscode.window.showInformationMessage(`${PRODUCT}: Flash is already running.`);
		return;
	}

	copying = true;
	try {
		// Typing from here on is dropped: the board is on its way to a reset.
		await withSerialWritesBlocked(() => copyToBoard(context));
	} finally {
		copying = false;
	}
}

/**
 * Connect, build for the board that answered, then write.
 *
 * The order matters: the board version decides which image the hex is built
 * from, and everything that can refuse a build has to run before `flashBoard`,
 * which halts the target before it asks for the data. A refusal after that point
 * leaves a stopped board running nothing.
 */
async function copyToBoard(context: vscode.ExtensionContext): Promise<void> {
	// Before connecting, or a workspace with nothing in it costs a device chooser.
	if (!hasSomethingToBuild()) return;
	if (!(await connectBoard())) return;

	const version = boardVersion();
	if (!version) {
		void vscode.window.showErrorMessage(
			`${PRODUCT}: the micro:bit did not say which version it is, so there is no way to know what to build. ` +
				'Disconnect and connect again.'
		);
		return;
	}

	// Building can outlast the board: `flashBoard` re-checks both against this.
	const serialNumber = boardSerialNumber();

	const prepared = await prepareHex(context, version);
	if (!prepared) return;

	// No title: withProgress joins a title and a reported message with a hardcoded
	// ": " that reads oddly next to a full sentence, so every stage's message
	// carries the whole line and there is nothing for the title to duplicate.
	const step = createProgress(version);
	const flashed = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification },
		(progress) =>
			flashBoard({ version, serialNumber }, hexFor(prepared.hex), (stage, value) =>
				progress.report(step(stage, value))
			)
	);
	if (!flashed) return;

	log(`Flashed ${prepared.files.length} file(s) to a micro:bit ${version}`);
	void vscode.window.showInformationMessage(
		`${PRODUCT}: copied ${prepared.files.length} file(s)${projectClause(prepared)} to the micro:bit, ` +
			`${listNames(prepared.files)}.`
	);
}

/** Long projects would otherwise turn the success toast into a wall of filenames. */
const NAMES_SHOWN = 6;

function listNames(files: readonly { name: string }[]): string {
	const names = files.map((file) => file.name);
	if (names.length <= NAMES_SHOWN) return names.join(', ');
	return `${names.slice(0, NAMES_SHOWN).join(', ')}, and ${names.length - NAMES_SHOWN} more`;
}

/** `flashBoard` already confirmed the board before this runs, so it never refuses. */
const hexFor =
	(hex: string): FlashDataSource =>
	async () =>
		hex;
