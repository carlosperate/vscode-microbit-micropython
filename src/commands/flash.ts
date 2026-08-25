import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { MAX_FILENAME_BYTES, type SelectedFile, type Selection, type SkipReason } from '../files/select';
import { chooseWorkspaceRoot, selectWorkspaceFiles } from '../files/workspace';
import { readFirmware } from '../hex/assets';
import { buildFs, FirmwareError, generateHex, StorageFullError, type Built } from '../hex/build';
import { log } from '../log';

/**
 * Flash cannot write to a board yet, so it builds the hex it would send and
 * says so. Everything up to the moment bytes leave the machine is real.
 */
export async function flash(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		void vscode.window.showWarningMessage(`${PRODUCT}: open a folder first, there is nothing to flash.`);
		return;
	}

	// Dismissing the pick is an answer, so it passes without a word.
	const root = await chooseWorkspaceRoot();
	if (!root) return;

	// A browser host reads the workspace over the network, so this fails rather
	// than coming back empty. Unguarded, VS Code answers with a modal of its own
	// carrying the raw reason and nothing about the micro:bit.
	let selection: Selection;
	try {
		selection = await selectWorkspaceFiles(root);
	} catch (error) {
		log(`Could not read the workspace: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: could not read the files in this folder. ${messageOf(error)}`);
		return;
	}

	report(root, selection);

	// Refused before a megabyte of firmware is read for a build that was never
	// going to happen, which on a school connection is a real cost. The omissions
	// go unmentioned here: this message already says everything was left out, and
	// listing them again underneath is two notifications for one fact.
	if (selection.files.length === 0) {
		void vscode.window.showWarningMessage(
			`${PRODUCT}: no files to flash. Every file in this folder was left out, see the output for why.`
		);
		return;
	}

	warnAboutOmissions(selection);

	try {
		const started = Date.now();
		const { hex, used, available } = await buildForAnyBoard(context.extensionUri, selection.files);
		log(`Built a hex of ${hex.length} bytes in ${Date.now() - started} ms, for any micro:bit`);
		log(`Using ${used} of ${available} bytes, the room a hex that runs on every micro:bit has`);

		const names = selection.files.map((file) => file.name).join(', ');
		void vscode.window.showInformationMessage(
			`${PRODUCT}: built a hex from ${selection.files.length} file(s) (${names}), using ${used} bytes of ` +
				`the ${available} a hex that runs on every micro:bit has room for. ` +
				'Writing to a board is not implemented yet.'
		);
	} catch (error) {
		log(`Could not build the hex: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: ${explain(error)}`);
	}
}

/**
 * Both images, because with no board to ask which version it is the hex has to
 * run on either, and the room reported is the room on whichever holds less.
 */
async function buildForAnyBoard(extensionUri: vscode.Uri, files: readonly SelectedFile[]): Promise<Built> {
	const images = await Promise.all([readFirmware(extensionUri, 'V1'), readFirmware(extensionUri, 'V2')]);
	return generateHex(buildFs(images, files));
}

/** Our own refusals already read as sentences; anything else needs framing. */
function explain(error: unknown): string {
	if (error instanceof StorageFullError || error instanceof FirmwareError) return error.message;
	return `the hex could not be built. ${messageOf(error)}`;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The output channel carries every exclusion; the notification carries few. */
function report(root: vscode.Uri, selection: Selection): void {
	log(`Selected ${selection.files.length} file(s) to flash from ${root}:`);
	for (const file of selection.files) log(`  ${file.name} (${file.data.length} bytes)`);
	for (const name of selection.folders) log(`  excluded ${name}/ (folder)`);
	for (const skip of selection.skipped) log(`  excluded ${skip.name} (${REASONS[skip.reason]})`);
}

const REASONS: Record<SkipReason, string> = {
	dotfile: 'name starts with a dot',
	excluded: 'excluded by settings',
	'name-too-long': `name longer than ${MAX_FILENAME_BYTES} bytes`,
	'name-has-slash': 'name contains a slash',
	empty: 'file is empty',
};

/**
 * Names the folders rather than what is inside them, so the message stays one
 * line whether a folder holds two files or two hundred. Once per flash: a toast
 * per file is what teaches a learner to dismiss them unread.
 */
function warnAboutOmissions(selection: Selection): void {
	const omitted = [
		...selection.folders.map((name) => `${name}/`),
		// `notable` is the core's judgement of what a user would be surprised by,
		// and a dotfile is not on that list: `.DS_Store` appears from opening the
		// folder in Finder. The output channel still has all of them.
		...selection.skipped.filter((skip) => skip.notable).map((skip) => skip.name),
	];
	if (omitted.length === 0) return;

	const folders = selection.folders.length ? ' The micro:bit filesystem has no folders.' : '';
	void vscode.window.showWarningMessage(`${PRODUCT}: not copied to the board: ${omitted.join(', ')}.${folders}`);
}
