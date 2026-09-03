/**
 * Everything both entry points do the same way. The two hosts reach a board by
 * unrelated means, so the commands are the seam and everything else sits above.
 */
import * as vscode from 'vscode';

import { showMenu } from './commands/showMenu';
import { COMMANDS, PRODUCT, type CommandId } from './config';
import { createLog, log } from './log';
import { createSerialMonitor } from './serial/eclipse';
import { filesForSimulator, openSimulator, openSimulatorTerminal, runInSimulator } from './simulator/commands';
import { createSimulator } from './simulator/view';

export type CommandHandler = (context: vscode.ExtensionContext, ...args: unknown[]) => Promise<void>;

/** Which entry point ran. Handed back from `activate` because nothing else can see it. */
export interface ExtensionApi {
	entry: Entry;
}

export type Entry = 'browser' | 'node';

/** What one entry point supplies, over the shared wiring below. */
export interface Host {
	entry: Entry;
	commands: Partial<Record<CommandId, CommandHandler>>;
	/** Runs once the output channel exists. */
	start(context: vscode.ExtensionContext): void;
	/** Absent where nothing can be paired, which drops both menu entries. */
	boardAttached?(): boolean;
}

export function activateHost(context: vscode.ExtensionContext, host: Host): ExtensionApi {
	createLog(context);
	log(`Extension activated, ${host.entry} entry`);

	createSerialMonitor(context);
	host.start(context);

	// The simulator is the one feature that belongs to both hosts, so it is wired
	// here rather than twice over in the two entry points.
	const simulator = createSimulator(context, () => filesForSimulator(context));

	const implemented: Partial<Record<CommandId, CommandHandler>> = {
		...host.commands,
		[COMMANDS.showMenu]: (forMenu) => showMenu(forMenu, host.boardAttached?.()),
		[COMMANDS.openSimulator]: openSimulator(simulator),
		[COMMANDS.runInSimulator]: runInSimulator(simulator),
		[COMMANDS.openSimulatorTerminal]: openSimulatorTerminal(simulator),
	};

	// Manifest titles keep stub notifications in sync with the command palette.
	const titles = contributedTitles(context);
	for (const id of Object.values(COMMANDS)) {
		const implementation = implemented[id];
		context.subscriptions.push(
			// Whatever a caller passes is forwarded intact, rather than dropped here.
			vscode.commands.registerCommand(id, async (...args: unknown[]) => {
				log(`Running ${id}`);
				try {
					if (implementation) return await implementation(context, ...args);
					void vscode.window.showInformationMessage(
						`${PRODUCT}: ${titles.get(id) ?? id} is not implemented yet.`
					);
				} catch (error) {
					// Rethrown: anything reaching here is a defect, and should stay loud.
					log(`${id} failed: ${String(error)}`);
					throw error;
				}
			})
		);
	}

	return { entry: host.entry };
}

function contributedTitles(context: vscode.ExtensionContext): Map<string, string> {
	const contributed: { command: string; title: string }[] =
		context.extension.packageJSON?.contributes?.commands ?? [];
	return new Map(contributed.map((entry) => [entry.command, entry.title]));
}
