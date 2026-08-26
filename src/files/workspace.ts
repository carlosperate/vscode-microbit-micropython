import * as vscode from 'vscode';

import { SECTION, SETTINGS } from '../config';
import { log } from '../log';
import { projectPath, type Refusal } from './project';
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
 *
 * The folder rather than its URI, because callers want its name as well and
 * looking that back up through `getWorkspaceFolder` is a round trip to recover
 * something this function already had.
 */
export async function chooseWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
	// Read fresh, never cached: a host swaps the folder in place, and a cache
	// keyed on `onDidChangeWorkspaceFolders` never fires in `vscode-test-web`.
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 1) return folders[0];

	return vscode.window.showWorkspaceFolderPick({
		placeHolder: 'Which folder should go on the micro:bit?',
	});
}

/** Where the files come from, and how to name it in a message. */
export interface Project {
	uri: vscode.Uri;
	/** Empty when it is the workspace folder itself, which is the default. */
	path: string;
}

/** The configured folder, or why it cannot be used. The caller does the wording. */
export type ProjectResult = ({ ok: true } & Project) | { ok: false; problem: Problem; named: string };

export type Problem = Refusal | 'missing' | 'not-a-folder' | 'unreadable';

/**
 * The workspace folder, then whatever `projectFolder` says below it.
 *
 * The setting is read against the **workspace folder**, never against the folder
 * it names: scoping it to that one would need the folder to exist in order to
 * read the setting that says where it is, which fails exactly when the setting
 * is wrong and the message matters most.
 *
 * Read fresh here for the same reason the folder above it is, so changing the
 * setting takes effect on the next command with nothing to invalidate.
 */
export async function resolveProject(workspace: vscode.WorkspaceFolder): Promise<ProjectResult> {
	const configured = vscode.workspace.getConfiguration(SECTION, workspace.uri).get<unknown>(SETTINGS.projectFolder);
	const resolved = projectPath(configured);

	if ('refused' in resolved) {
		log(`${SETTINGS.projectFolder}: ignored, ${resolved.refused}`);
		return { ok: false, problem: resolved.refused, named: String(configured) };
	}
	if (resolved.segments.length === 0) return { ok: true, uri: workspace.uri, path: '' };

	const uri = vscode.Uri.joinPath(workspace.uri, ...resolved.segments);
	const path = resolved.segments.join('/');
	let stat: vscode.FileStat;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch (error) {
		log(`${SETTINGS.projectFolder}: could not read ${uri}: ${String(error)}`);
		// Only a not-found says the setting is wrong. A permission error or a
		// provider that is away sends the user to correct a path that was right.
		const absent = error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
		return { ok: false, problem: absent ? 'missing' : 'unreadable', named: path };
	}

	if ((stat.type & vscode.FileType.Directory) === 0) return { ok: false, problem: 'not-a-folder', named: path };
	return { ok: true, uri, path };
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
