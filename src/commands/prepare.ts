import * as vscode from 'vscode';

import { PRODUCT, SETTINGS, settingId } from '../config';
import { MAX_FILENAME_BYTES, type SelectedFile, type Selection, type SkipReason } from '../files/select';
import { chooseWorkspaceFolder, resolveProject, selectWorkspaceFiles, type Problem } from '../files/workspace';
import { readFirmware } from '../hex/assets';
import { buildFs, FirmwareError, generateHex, StorageFullError, type Built } from '../hex/build';
import { log } from '../log';

/** A hex, what it costs on the device, and where it came from. */
export interface Prepared extends Built {
	folder: vscode.WorkspaceFolder;
	/** The project folder below it, empty when that is the folder itself. */
	project: string;
	files: readonly SelectedFile[];
}

/**
 * Names the project folder, and only when there is one to name: a clause that
 * never varies is noise in every message it appears in.
 */
export const projectClause = (prepared: Prepared) => (prepared.project ? ` in ${prepared.project}/` : '');

/**
 * Everything Flash and Save Hex do before they diverge: pick the folder, choose
 * the files, build a hex that runs on any micro:bit.
 *
 * `undefined` means the command has nothing left to do, and the user has either
 * been told why or dismissed the folder pick and needs no telling.
 */
export async function prepareHex(context: vscode.ExtensionContext): Promise<Prepared | undefined> {
	if (!vscode.workspace.workspaceFolders?.length) {
		void vscode.window.showWarningMessage(`${PRODUCT}: open a folder first, there is nothing to build.`);
		return undefined;
	}

	// Dismissing the pick is an answer, so it passes without a word.
	const folder = await chooseWorkspaceFolder();
	if (!folder) return undefined;

	const project = await resolveProject(folder);
	if (!project.ok) {
		void vscode.window.showErrorMessage(`${PRODUCT}: ${explainProject(project.problem, project.named)}`);
		return undefined;
	}

	// A browser host reads the workspace over the network, so this fails rather
	// than coming back empty, and unguarded VS Code puts up its own raw modal.
	let selection: Selection;
	try {
		selection = await selectWorkspaceFiles(project.uri);
	} catch (error) {
		log(`Could not read the workspace: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: could not read the files in this folder. ${messageOf(error)}`);
		return undefined;
	}

	report(project.uri, selection);

	// Before a megabyte of firmware is read for a build that was never going to
	// happen. No omissions list: this already says everything was left out.
	if (selection.files.length === 0) {
		const where = project.path ? `${project.path}/` : 'this folder';
		void vscode.window.showWarningMessage(
			`${PRODUCT}: no files to put on the board. Every file in ${where} was left out, see the output for why.`
		);
		return undefined;
	}

	warnAboutOmissions(selection);

	try {
		const started = Date.now();
		const built = await buildForAnyBoard(context.extensionUri, selection.files);
		log(
			`Built a hex of ${built.hex.length} bytes in ${Date.now() - started} ms, using ${built.used} of ` +
				`${built.available} bytes of the room a hex that runs on every micro:bit has`
		);
		return { ...built, folder, project: project.path, files: selection.files };
	} catch (error) {
		log(`Could not build the hex: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: ${explain(error)}`);
		return undefined;
	}
}

/** Whatever an error carries, in the one form a sentence can be built around. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Both images, because with no board to ask which version it is the hex has to
 * run on either, and the room reported is the room on whichever holds less.
 */
async function buildForAnyBoard(extensionUri: vscode.Uri, files: readonly SelectedFile[]): Promise<Built> {
	const images = await Promise.all([readFirmware(extensionUri, 'V1'), readFirmware(extensionUri, 'V2')]);
	return generateHex(buildFs(images, files));
}

/**
 * Every one of these is a typo in the user's own settings file, so the message
 * has to be enough to go and fix it without opening the output channel: which
 * setting, what it currently says, and the two ways to change it.
 */
function explainProject(problem: Problem, named: string): string {
	const fix = `Set ${settingId(SETTINGS.projectFolder)}, or run "${PRODUCT}: Select Project Folder".`;
	switch (problem) {
		case 'not-a-string':
			return `${settingId(SETTINGS.projectFolder)} has to be a folder path. ${fix}`;
		case 'outside-the-workspace':
			return `the project folder "${named}" is outside this workspace folder. ${fix}`;
		case 'missing':
			return `there is no "${named}" folder in this workspace folder. ${fix}`;
		case 'not-a-folder':
			return `the project folder "${named}" is a file, not a folder. ${fix}`;
		// No `fix`: the setting may be perfectly right and the filesystem away.
		case 'unreadable':
			return `the project folder "${named}" could not be read, see the output for why.`;
	}
}

/** Our own refusals already read as sentences; anything else needs framing. */
function explain(error: unknown): string {
	if (error instanceof StorageFullError || error instanceof FirmwareError) return error.message;
	return `the hex could not be built. ${messageOf(error)}`;
}

/** The output channel carries every exclusion; the notification carries few. */
function report(from: vscode.Uri, selection: Selection): void {
	log(`Selected ${selection.files.length} file(s) from ${from}:`);
	for (const file of selection.files) log(`  ${file.name} (${file.data.length} bytes)`);
	for (const name of selection.folders) log(`  excluded ${name}/ (folder)`);
	for (const skip of selection.skipped) log(`  excluded ${skip.name} (${REASONS[skip.reason]})`);
}

const REASONS: Record<SkipReason, string> = {
	dotfile: 'name starts with a dot',
	excluded: 'excluded by settings',
	'build-output': 'a .hex build output',
	'name-too-long': `name longer than ${MAX_FILENAME_BYTES} bytes`,
	'name-has-slash': 'name contains a slash',
	empty: 'file is empty',
};

/**
 * Names the folders rather than what is inside them, so the message stays one
 * line whether a folder holds two files or two hundred. Once per build: a toast
 * per file is what teaches a learner to dismiss them unread.
 */
function warnAboutOmissions(selection: Selection): void {
	const omitted = [
		...selection.folders.map((name) => `${name}/`),
		// `notable` is the core's judgement of what would surprise a user, which a
		// dotfile is not: `.DS_Store` appears from merely opening the folder.
		...selection.skipped.filter((skip) => skip.notable).map((skip) => skip.name),
	];
	if (omitted.length === 0) return;

	const folders = selection.folders.length ? ' The micro:bit filesystem has no folders.' : '';
	void vscode.window.showWarningMessage(`${PRODUCT}: not copied to the board: ${omitted.join(', ')}.${folders}`);
}
