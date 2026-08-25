import * as vscode from 'vscode';

import { COMMANDS, PRODUCT } from './config';
import { createLog, log } from './log';
import { createStatusBar } from './ui/statusbar';

export function activate(context: vscode.ExtensionContext): void {
	createLog(context);
	log('Extension activated');

	context.subscriptions.push(createStatusBar());

	// Registered from our own list of ids, not from the manifest, so the tests'
	// manifest-versus-code comparison stays a real check. The titles do come from
	// the manifest: they are user-facing prose, and a second copy of them here
	// would drift the moment one is reworded.
	const titles = contributedTitles(context);
	for (const id of Object.values(COMMANDS)) {
		context.subscriptions.push(
			vscode.commands.registerCommand(id, () => {
				log(`${id} is not implemented yet`);
				void vscode.window.showInformationMessage(`${PRODUCT}: ${titles.get(id) ?? id} is not implemented yet.`);
			})
		);
	}
}

export function deactivate(): void {}

function contributedTitles(context: vscode.ExtensionContext): Map<string, string> {
	const contributed: { command: string; title: string }[] =
		context.extension.packageJSON?.contributes?.commands ?? [];
	return new Map(contributed.map((entry) => [entry.command, entry.title]));
}
