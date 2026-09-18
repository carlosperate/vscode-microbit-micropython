/**
 * The link to the BBC micro:bit Manager. The dependency in the manifest
 * guarantees it activated first, so its exports are there without an await;
 * what is not guaranteed is their version, which this side checks.
 */
import type { MenuGroup, MicrobitManagerApi } from 'vscode-bbcmicrobit-manager-api';
import * as vscode from 'vscode';

import { EXTENSION_ID, MANAGER_API_VERSION, MANAGER_EXTENSION, PRODUCT } from '../config';
import { log } from '../log';
import { checkManager, type ManagerCheck } from './api';

export interface ManagerStatus {
	/** Whether the status bar menu lists this extension's commands. */
	readonly registered: boolean;
	/** Why the board cannot be reached from here, when it cannot. */
	readonly problem: string | undefined;
}

export interface ManagerLink {
	/** The API once its version is accepted. Undefined has already been explained. */
	api(): MicrobitManagerApi | undefined;
	readonly status: ManagerStatus;
}

const SHOW_EXTENSION = 'Show Extension';

export function linkManager(context: vscode.ExtensionContext, group: MenuGroup): ManagerLink {
	const check = checkManager(vscode.extensions.getExtension(MANAGER_EXTENSION)?.exports, MANAGER_API_VERSION);
	const status: { registered: boolean; problem: string | undefined } = { registered: false, problem: undefined };

	if (check.kind === 'accepted') {
		try {
			context.subscriptions.push(check.api.registerMenuGroup(group));
			status.registered = true;
			log(`Linked to the micro:bit Manager, API ${check.api.version}`);
		} catch (error) {
			// This extension's own defect, and the board still works without the menu entries.
			log(`The micro:bit Manager refused the menu group: ${String(error)}`);
		}
	} else {
		status.problem = describe(check).problem;
		log(status.problem);
		// The manager refuses nobody, so nothing else will say so.
		explain(check);
	}

	return {
		api: () => {
			if (check.kind === 'accepted') return check.api;
			explain(check);
			return undefined;
		},
		status,
	};
}

type Refusal = Exclude<ManagerCheck, { kind: 'accepted' }>;

function describe(check: Refusal): { problem: string; update: string } {
	switch (check.kind) {
		case 'missing':
			return {
				// The declared dependency means the manager is running; its exports are what went wrong.
				problem: 'the BBC micro:bit Manager did not provide an API this extension can use, and it is what talks to the board.',
				update: MANAGER_EXTENSION,
			};
		case 'update-manager':
			return {
				problem:
					'this needs a newer BBC micro:bit Manager to reach the board. ' +
					`(The manager serves API ${check.served}, this needs ${MANAGER_API_VERSION}.)`,
				update: MANAGER_EXTENSION,
			};
		case 'update-extension':
			return {
				problem:
					`the BBC micro:bit Manager installed is newer than this extension supports. Update ${PRODUCT} to reach the board. ` +
					`(The manager serves API ${check.served}, this was built for ${MANAGER_API_VERSION}.)`,
				update: EXTENSION_ID,
			};
	}
}

function explain(check: Refusal): void {
	const { problem, update } = describe(check);
	void vscode.window
		.showErrorMessage(`${PRODUCT}: ${problem}`, SHOW_EXTENSION)
		.then((picked) => (picked ? vscode.commands.executeCommand('extension.open', update) : undefined))
		.then(undefined, (error: unknown) => log(`Could not show the manager problem: ${String(error)}`));
}
