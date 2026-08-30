import * as vscode from 'vscode';

import { PRODUCT, SETTINGS, settingId } from '../config';
import { MAX_FILENAME_BYTES, type SelectedFile, type Selection, type SkipReason } from '../files/select';
import { chooseWorkspaceFolder, resolveProject, selectWorkspaceFiles, type Problem } from '../files/workspace';
import { readFirmware } from '../hex/assets';
import { buildFor, FirmwareError, StorageFullError, type BoardVersion, type Built } from '../hex/build';
import { log } from '../log';

/** A hex, what it costs on the device, and where it came from. */
export interface Prepared extends Built {
	folder: vscode.WorkspaceFolder;
	/** The project folder below it, empty when that is the folder itself. */
	project: string;
	files: readonly SelectedFile[];
}

/**
 * Whether there is a workspace at all. Exported so Flash can ask before it
 * connects: reaching this check afterwards means opening a device chooser and
 * pairing a board, only to say there was nothing to send it.
 */
export function hasSomethingToBuild(): boolean {
	if (vscode.workspace.workspaceFolders?.length) return true;

	void vscode.window.showWarningMessage(`${PRODUCT}: open a folder first, there is nothing to build.`);
	return false;
}

/** Omits the common workspace-root case from notifications. */
export const projectClause = (prepared: Prepared) => (prepared.project ? ` in ${prepared.project}/` : '');

/** Long projects would otherwise turn the success toast into a wall of filenames. */
const NAMES_SHOWN = 6;

export function listNames(files: readonly { name: string }[]): string {
	const names = files.map((file) => file.name);
	if (names.length <= NAMES_SHOWN) return names.join(', ');
	return `${names.slice(0, NAMES_SHOWN).join(', ')}, and ${names.length - NAMES_SHOWN} more`;
}

/**
 * Shared preparation for Flash and Save Hex: resolve, select, and build.
 *
 * `board` is the version to build for when it is known, which is what makes the
 * storage figures that board's own. `undefined` means the command has nothing
 * left to do, and the user has either been told why or dismissed the folder pick
 * and needs no telling.
 */
export async function prepareHex(
	context: vscode.ExtensionContext,
	board?: BoardVersion
): Promise<Prepared | undefined> {
	if (!hasSomethingToBuild()) return undefined;

	// Dismissing the pick is an answer, so it passes without a word.
	const folder = await chooseWorkspaceFolder();
	if (!folder) return undefined;

	const project = await resolveProject(folder);
	if (!project.ok) {
		void vscode.window.showErrorMessage(`${PRODUCT}: ${explainProject(project.problem, project.named)}`);
		return undefined;
	}

	// Browser-backed workspace reads can reject instead of returning an empty list.
	let selection: Selection;
	try {
		selection = await selectWorkspaceFiles(project.uri);
	} catch (error) {
		log(`Could not read the workspace: ${String(error)}`);
		void vscode.window.showErrorMessage(
			`${PRODUCT}: could not read the files in this folder, see the output for why.`
		);
		return undefined;
	}

	report(project.uri, selection);

	// Refuse before loading firmware when no selected file could use it.
	if (selection.files.length === 0) {
		const where = project.path ? `${project.path}/` : 'this folder';
		void vscode.window.showWarningMessage(
			`${PRODUCT}: no files to put on the board. Every file in ${where} was left out, see the output for why.`
		);
		return undefined;
	}

	warnAboutOmissions(context, project.uri, selection);

	try {
		const started = Date.now();
		const built = await buildFor((version) => readFirmware(context.extensionUri, version), board, selection.files);
		log(
			`Built a ${board ?? 'universal'} hex of ${built.hex.length} bytes in ${Date.now() - started} ms, ` +
				`using ${built.used} of ${built.available} bytes of storage`
		);
		return { ...built, folder, project: project.path, files: selection.files };
	} catch (error) {
		log(`Could not build the hex: ${String(error)}`);
		void vscode.window.showErrorMessage(`${PRODUCT}: ${explain(error)}`);
		return undefined;
	}
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

/** Our own refusals already read as sentences; anything else stays in the log. */
function explain(error: unknown): string {
	if (error instanceof StorageFullError || error instanceof FirmwareError) return error.message;
	return 'the hex could not be built, see the output for why.';
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

/** Keyed per project: two projects can both have a `lib/` and must warn independently. */
const LAST_OMISSIONS_SHOWN = 'lastOmissionsShown';

/**
 * Reports notable omissions once per distinct set, not once per flash. A `lib/`
 * folder a user already knows about does not need re-announcing on every edit;
 * a newly-appearing omission, or one that disappears, does.
 */
function warnAboutOmissions(context: vscode.ExtensionContext, project: vscode.Uri, selection: Selection): void {
	const omitted = [
		...selection.folders.map((name) => `${name}/`),
		// Routine dotfiles remain in the output channel instead of every notification.
		...selection.skipped.filter((skip) => skip.notable).map((skip) => skip.name),
	];

	const key = `${LAST_OMISSIONS_SHOWN}:${project.toString()}`;
	const signature = omitted.join('\n');
	if (signature === context.workspaceState.get<string>(key)) return;
	// Best effort: a failed write repeats a warning next time rather than losing one.
	void context.workspaceState
		.update(key, signature)
		.then(undefined, (error: unknown) => log(`Could not remember the omission warning shown: ${String(error)}`));
	if (omitted.length === 0) return;

	const folders = selection.folders.length ? ' The micro:bit filesystem has no folders.' : '';
	void vscode.window.showWarningMessage(`${PRODUCT}: left off the micro:bit: ${omitted.join(', ')}.${folders}`);
}
