/**
 * Everything both entry points do, which is all of it: the board belongs to the
 * manager extension, so nothing here differs between the hosts any more. Two
 * entry points remain because the manifest declares `main` and `browser`, and
 * which one the host loaded is worth being able to see.
 */
import * as vscode from 'vscode';

import { flash } from './commands/flash';
import { saveHex } from './commands/saveHex';
import { selectProjectFolder } from './commands/selectProjectFolder';
import { COMMANDS, type CommandId } from './config';
import { createLog, log } from './log';
import { linkManager, type ManagerStatus } from './manager/link';
import { createMode } from './manager/mode';
import { createSerialMonitor } from './serial/eclipse';
import { filesForSimulator, openSimulator, openSimulatorTerminal, runInSimulator } from './simulator/commands';
import { createSimulator } from './simulator/view';

export type CommandHandler = (context: vscode.ExtensionContext, ...args: unknown[]) => Promise<void>;

export type Entry = 'browser' | 'node';

/** Which entry point ran, and how the link to the manager went. Handed back from `activate` because nothing else can see either. */
export interface ExtensionApi {
	entry: Entry;
	manager: ManagerStatus;
}

export function activateHost(context: vscode.ExtensionContext, entry: Entry): ExtensionApi {
	createLog(context);
	log(`Extension activated, ${entry} entry`);

	createSerialMonitor(context);
	// Registering is what puts this extension's view in the shared panel: the
	// manager sets the context key it is gated on, and nothing else does.
	const manager = linkManager(context, createMode(context));
	const simulator = createSimulator(context, () => filesForSimulator(context), manager);

	const implemented: Record<CommandId, CommandHandler> = {
		[COMMANDS.flash]: flash(manager),
		[COMMANDS.saveHex]: saveHex(manager),
		[COMMANDS.selectProjectFolder]: selectProjectFolder,
		[COMMANDS.openSimulator]: openSimulator(simulator),
		[COMMANDS.runInSimulator]: runInSimulator(simulator),
		[COMMANDS.openSimulatorTerminal]: openSimulatorTerminal(simulator),
	};

	for (const id of Object.values(COMMANDS)) {
		context.subscriptions.push(
			// Whatever a caller passes is forwarded intact, rather than dropped here.
			vscode.commands.registerCommand(id, async (...args: unknown[]) => {
				log(`Running ${id}`);
				try {
					await implemented[id](context, ...args);
				} catch (error) {
					// Rethrown: anything reaching here is a defect, and should stay loud.
					log(`${id} failed: ${String(error)}`);
					throw error;
				}
			})
		);
	}

	return { entry, manager: manager.status };
}
