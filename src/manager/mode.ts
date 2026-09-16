/**
 * What this extension registers with the manager: a segment labelled
 * MicroPython, a claim on workspaces holding Python files, and the entries the
 * status bar menu offers while this is the active mode. The views themselves are
 * the manifest's, gated on the key the manager sets for this mode.
 */
import type { Mode } from 'bbcmicrobit-manager-api';
import * as vscode from 'vscode';

import { COMMANDS, EXTENSION_ID, MANAGER_API_VERSION, MODE_ID, MODE_LABEL, SECTION, SETTINGS } from '../config';
import { hasPythonFile } from '../files/claim';
import { resolveProject } from '../files/workspace';
import { log } from '../log';

/** Long enough to swallow a burst of file events, short enough that the panel still answers a save. */
const CLAIM_SETTLE_MS = 300;

/** In the order the work happens, which is neither the manifest's nor the palette's. */
const MENU: readonly string[] = [
	COMMANDS.flash,
	// Beside Flash because it is the other way to run the program; opening the
	// simulator without running anything is the detour, so it follows.
	COMMANDS.runInSimulator,
	COMMANDS.openSimulator,
	COMMANDS.openSimulatorTerminal,
	COMMANDS.saveHex,
	COMMANDS.selectProjectFolder,
];

export function createMode(context: vscode.ExtensionContext): Mode {
	const claimChanged = new vscode.EventEmitter<void>();
	// One answer a beat after the last change: unpacking a package or creating a
	// virtual environment writes hundreds of files, and each answer reads the workspace.
	let due: ReturnType<typeof setTimeout> | undefined;
	const changed = () => {
		if (due !== undefined) clearTimeout(due);
		due = setTimeout(() => {
			due = undefined;
			claimChanged.fire();
		}, CLAIM_SETTLE_MS);
	};
	// Creations and deletions only: an edit changes nothing about whether a file is there.
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.py', false, true, false);
	context.subscriptions.push(
		claimChanged,
		watcher,
		watcher.onDidCreate(changed),
		watcher.onDidDelete(changed),
		vscode.workspace.onDidChangeWorkspaceFolders(changed),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(`${SECTION}.${SETTINGS.projectFolder}`)) changed();
		}),
		{
			dispose: () => {
				if (due !== undefined) clearTimeout(due);
			},
		}
	);

	// Manifest titles, so the menu and the palette cannot drift.
	const titles = contributedTitles(context);
	return {
		apiVersion: MANAGER_API_VERSION,
		id: MODE_ID,
		extensionId: EXTENSION_ID,
		label: MODE_LABEL,
		claimsWorkspace,
		onDidChangeWorkspaceClaim: claimChanged.event,
		menuCommands: MENU.map((command) => ({ command, label: titles.get(command) ?? command })),
	};
}

/**
 * A workspace looks like this extension's own when a project folder holds a
 * Python file. The project folder rather than the root, so a setting pointing at
 * `src/` claims the same workspace a flash would build from.
 */
export async function claimsWorkspace(): Promise<boolean> {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const project = await resolveProject(folder);
		if (!project.ok) continue;
		try {
			const entries = await vscode.workspace.fs.readDirectory(project.uri);
			const files = entries.filter(([, type]) => (type & vscode.FileType.File) !== 0).map(([name]) => name);
			if (hasPythonFile(files)) return true;
		} catch (error) {
			log(`Could not look for Python files in ${project.uri}: ${String(error)}`);
		}
	}
	return false;
}

function contributedTitles(context: vscode.ExtensionContext): Map<string, string> {
	const contributed: { command: string; title: string }[] =
		context.extension.packageJSON?.contributes?.commands ?? [];
	return new Map(contributed.map((entry) => [entry.command, entry.title]));
}
