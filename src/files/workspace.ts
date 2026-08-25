import * as vscode from 'vscode';

import { SECTION, SETTINGS } from '../config';
import { log } from '../log';
import { selectFiles, type DirEntry, type Selection } from './select';

/**
 * Which folder goes on the board, when a window has more than one.
 *
 * Asked rather than guessed. Files from two roots must never be combined, and
 * the alternative to asking is picking one silently, which flashes the wrong
 * project and reports success. Following the active editor would guess right
 * most of the time and still needs an answer for a window with no editor open,
 * a file belonging to no root, and an untitled document.
 *
 * Resolves `undefined` only when the user dismissed the pick. Callers check for
 * an open folder first, so there is one meaning for it and no message to write.
 */
export async function chooseWorkspaceRoot(): Promise<vscode.Uri | undefined> {
	// Read fresh on every call rather than caching at activation. A host can swap
	// the workspace folder in place with `updateWorkspaceFolders`, and there is
	// then nothing to go stale. It also makes the swap testable in harnesses that
	// never deliver `onDidChangeWorkspaceFolders`, where a cache invalidated by
	// that event would silently keep the old root forever.
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 1) return folders[0].uri;

	const chosen = await vscode.window.showWorkspaceFolderPick({
		placeHolder: 'Which folder should go on the micro:bit?',
	});
	return chosen?.uri;
}

/**
 * The one place `selectFiles` meets a real editor: it turns `workspace.fs` into
 * the readers the pure core takes, and reads the settings it needs.
 */
export async function selectWorkspaceFiles(root: vscode.Uri): Promise<Selection> {
	const readDir = async (): Promise<DirEntry[]> => {
		const entries = await vscode.workspace.fs.readDirectory(root);
		return entries.map(([name, type]) => ({
			name,
			// A symlink to a directory carries both bits, and following it into the
			// tree is not something a flat device filesystem has any use for.
			isDirectory: (type & vscode.FileType.Directory) !== 0,
		}));
	};

	// `Uri.joinPath` rather than string surgery, so every workspace scheme works.
	const readFile = (name: string) => vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name));

	return selectFiles(readDir, readFile, excludeGlobs(root));
}

/**
 * A setting's declared type is a hint to the editor and nothing more: whatever
 * is in the JSON arrives here as it was written. `"files.exclude": "*.md"`, the
 * obvious mistake given the name, would otherwise reach the pure core and fail
 * as `exclude.some is not a function`, which reads as a filesystem fault rather
 * than a typo the user can go and correct.
 */
function excludeGlobs(root: vscode.Uri): string[] {
	const configured = vscode.workspace.getConfiguration(SECTION, root).get<unknown>(SETTINGS.filesExclude, []);
	if (Array.isArray(configured)) {
		const globs = configured.filter((pattern): pattern is string => typeof pattern === 'string');
		if (globs.length !== configured.length) log(`${SETTINGS.filesExclude}: ignored an entry that is not a glob`);
		return globs;
	}

	log(`${SETTINGS.filesExclude}: ignored, it has to be a list of globs`);
	return [];
}
