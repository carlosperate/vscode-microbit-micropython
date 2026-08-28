import * as vscode from 'vscode';

import { SECTION, SETTINGS } from '../config';
import { log } from '../log';
import { projectPath, type Refusal } from './project';
import { selectFiles, type DirEntry, type Selection } from './select';

/**
 * Picks one root in a multi-root window instead of silently combining projects.
 * The current folder list is read on every command because some web hosts swap
 * roots without delivering `onDidChangeWorkspaceFolders`.
 */
export async function chooseWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
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
 * Resolves `projectFolder` fresh against the workspace root that owns the setting.
 * Reading it against the named folder would hide the setting when that folder is
 * missing, exactly when its diagnostic is needed.
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
		// Only not-found means the configured path itself is wrong.
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
			// Directory symlinks remain folders so the flat selector never reads them.
			isDirectory: (type & vscode.FileType.Directory) !== 0,
		}));
	};

	// `Uri.joinPath` rather than string surgery, so every workspace scheme works.
	const readFile = (name: string) => vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name));

	return selectFiles(readDir, readFile, excludeGlobs(root));
}

/** Filters hand-edited settings before they reach the pure glob matcher. */
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
