/**
 * Flashing where no device chooser exists: write the hex to the drive the board
 * mounts, and DAPLink programs the target and reboots it.
 */
import * as vscode from 'vscode';

import { hasSomethingToBuild, listNames, prepareHex, projectClause } from '../commands/prepare';
import { saveHex } from '../commands/saveHex';
import { PRODUCT, SECTION, SETTINGS, settingId } from '../config';
import { findBoards, type Board } from '../drive/volume';
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

	const where = configuredPath();
	const search = await attachedBoards(where);
	if (search.boards.length === 0) return offerToSave(context, where, search.searched);
	const boards = search.boards;

	// Two boards on a machine is a classroom, not an edge case. One is not a question.
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
	// This board's own path, never a fresh search: discovery would ignore a
	// configured mount point and, on Windows, wait out the query all over again.
	const attached = await findBoards(driveIo, machine(), board.path)
		.then((boards) => boards.length > 0)
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

async function attachedBoards(configured: string): Promise<Search> {
	try {
		const boards = await findBoards(driveIo, machine(), configured || undefined);
		log(`Found ${boards.length} micro:bit drive(s)${boards.length ? `: ${describe(boards)}` : ''}`);
		return { boards, searched: true };
	} catch (error) {
		log(`Could not look for a micro:bit drive: ${String(error)}`);
		return { boards: [], searched: false };
	}
}

const configuredPath = () =>
	vscode.workspace.getConfiguration(SECTION).get<string>(SETTINGS.drivePath)?.trim() ?? '';

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

/** Three reasons, one way out. Here it really is a file the user handles by hand. */
async function offerToSave(context: vscode.ExtensionContext, configured: string, searched: boolean): Promise<void> {
	const answer = await vscode.window.showWarningMessage(
		`${PRODUCT}: ${whyNoBoard(configured, searched)} Or save your program as a file and copy it across yourself.`,
		SAVE_HEX
	);
	if (answer === SAVE_HEX) await saveHex(context);
}

function whyNoBoard(configured: string, searched: boolean): string {
	const setting = settingId(SETTINGS.drivePath);
	if (configured) {
		return `there is no micro:bit at ${configured}, which is where ${setting} says to look. Correct that setting, or empty it to search.`;
	}

	// Plugging a board in will not fix this, so it must not read as a missing board.
	if (!searched) {
		return `this computer would not say which of its drives are removable, so there is nowhere to look for a micro:bit. Set ${setting} to where it is mounted.`;
	}

	return 'no micro:bit found. Plug one in and give it a moment to be ready.';
}
