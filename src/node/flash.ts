/**
 * Flashing where no device chooser exists: write the hex to the drive the board
 * mounts, and DAPLink programs the target and reboots it.
 */
import * as vscode from 'vscode';

import { hasSomethingToBuild, listNames, prepareHex, projectClause } from '../commands/prepare';
import { saveHex } from '../commands/saveHex';
import { PRODUCT } from '../config';
import { boardAt, findBoards, type Board } from '../drive/volume';
import { hexFilename } from '../filename';
import { log } from '../log';
import { createDriveIo, machine } from './io';

const driveIo = createDriveIo(log);

const SAVE_HEX = 'Save Hex';

/** One at a time: the board unmounts mid-write, and a second would find it gone. */
let copying = false;

export async function flashToDrive(context: vscode.ExtensionContext): Promise<void> {
	if (copying) {
		void vscode.window.showInformationMessage(`${PRODUCT}: Flash is already running.`);
		return;
	}

	copying = true;
	try {
		await copyToDrive(context);
	} finally {
		copying = false;
	}
}

async function copyToDrive(context: vscode.ExtensionContext): Promise<void> {
	// Before searching, or a workspace with nothing in it costs a prompt.
	if (!hasSomethingToBuild()) return;

	const { boards, searched } = await attachedBoards();
	if (boards.length === 0) return offerToSave(context, searched);

	// Two boards on a machine is a classroom, not an edge case, and the choice is
	// asked every time: flashing each of them in turn is the reason there are two.
	const board = boards.length === 1 ? boards[0] : await pick(boards);
	if (!board) return;

	// An unknown version still builds, for every board there is an image for.
	const prepared = await prepareHex(context, board.version);
	if (!prepared) return;

	const target = vscode.Uri.joinPath(vscode.Uri.file(board.path), hexFilename(prepared.folder.name));
	try {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `${PRODUCT}: flashing the micro:bit` },
			() => vscode.workspace.fs.writeFile(target, new TextEncoder().encode(prepared.hex))
		);
	} catch (error) {
		log(`Could not write ${target.fsPath}: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: ${await explainFailedFlash(board)}`);
		return;
	}

	// One hex, holding however many project files. Counting one against the other reads as neither.
	log(`Wrote ${target.fsPath}, the hex holding ${prepared.files.length} file(s)`);
	void vscode.window.showInformationMessage(
		`${PRODUCT}: flashing ${prepared.files.length} file(s)${projectClause(prepared)} to the micro:bit, ` +
			`${listNames(prepared.files)}.`
	);
}

/**
 * A board that took the whole program reboots itself, which can land before the
 * write is flushed, so a failure with the board already gone may have worked.
 */
async function explainFailedFlash(board: Board): Promise<string> {
	// This board's own path, never a fresh search, which on Windows would wait out the whole query again.
	const attached = await boardAt(driveIo, machine(), board.path)
		.then((found) => found !== undefined)
		.catch(() => true);

	return attached
		? 'the micro:bit could not be flashed, and it is still connected. See the output for why.'
		: 'the micro:bit disconnected while it was being flashed. If it restarted it may have your program: ' +
				'check the board, and flash again if it did not.';
}

/** Empty for no board, or empty because nothing could be looked at. */
interface Search {
	boards: Board[];
	searched: boolean;
}

async function attachedBoards(): Promise<Search> {
	try {
		const boards = await findBoards(driveIo, machine());
		log(`Found ${boards.length} micro:bit drive(s)${boards.length ? `: ${describe(boards)}` : ''}`);
		return { boards, searched: true };
	} catch (error) {
		log(`Could not look for a micro:bit drive: ${String(error)}`);
		return { boards: [], searched: false };
	}
}

const describe = (boards: readonly Board[]) =>
	boards.map((board) => `${board.path} (${board.version ?? 'unknown version'})`).join(', ');

/** The one place the mount point earns its space: it tells two boards apart. */
async function pick(boards: readonly Board[]): Promise<Board | undefined> {
	const picked = await vscode.window.showQuickPick(
		boards.map((board) => ({
			label: board.version ? `micro:bit ${board.version}` : 'micro:bit',
			description: board.path,
			board,
		})),
		{ title: PRODUCT, placeHolder: 'Which micro:bit do you want to flash?' }
	);
	return picked?.board;
}

/** Two reasons, one way out. Here it really is a file the user handles by hand. */
async function offerToSave(context: vscode.ExtensionContext, searched: boolean): Promise<void> {
	// Naming no cause on purpose: the check can fail from a policy that will never
	// allow it and from a machine that was merely slow, and they read the same here.
	const why = searched
		? 'no micro:bit found. Plug one in and give it a moment to be ready.'
		: 'could not check which drives are removable, so there was nowhere to look for a micro:bit. Try again.';

	const answer = await vscode.window.showWarningMessage(
		`${PRODUCT}: ${why} Or save your program as a file and copy it across yourself.`,
		SAVE_HEX
	);
	if (answer === SAVE_HEX) await saveHex(context);
}
