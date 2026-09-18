/**
 * What this extension registers with the manager: its commands for the status
 * bar menu, titled as the manifest titles them so the menu and the palette
 * cannot drift, and its sidebar, which the manager's panel can combine.
 */
import type { MenuGroup } from 'vscode-bbcmicrobit-manager-api';
import type * as vscode from 'vscode';

import { COMMANDS, CONTAINER_ID, PRODUCT } from '../config';

const MENU: readonly string[] = [
	COMMANDS.flash,
	// Beside Flash, the other way to run the program; opening the simulator alone is the detour.
	COMMANDS.runInSimulator,
	COMMANDS.openSimulator,
	COMMANDS.openSimulatorTerminal,
	COMMANDS.saveHex,
	COMMANDS.selectProjectFolder,
];

export function menuGroup(context: vscode.ExtensionContext): MenuGroup {
	const contributes = context.extension.packageJSON?.contributes;
	const contributed: { command: string; title: string }[] = contributes?.commands ?? [];
	const views: { id: string }[] = contributes?.views?.[CONTAINER_ID] ?? [];
	const titles = new Map(contributed.map((entry) => [entry.command, entry.title]));
	return {
		label: PRODUCT,
		commands: MENU.map((command) => ({ command, label: titles.get(command) ?? command })),
		sidebar: { container: CONTAINER_ID, views: views.map((view) => view.id) },
	};
}
