import { ConnectionStatus, type BoardVersion } from '@microbit/microbit-connection';
import * as vscode from 'vscode';

import { COMMANDS, PRODUCT } from '../config';
import { log } from '../log';
import { createVisibleStatus, describeStatus } from './status';

/** The always-visible entry point for connecting a board. */
export interface StatusBar extends vscode.Disposable {
	update(status: ConnectionStatus, board?: BoardVersion): void;
}

/**
 * Clicking it always opens the menu, whatever the status: a control that runs a
 * different command depending on what it currently reads is one users learn to
 * distrust.
 */
export function createStatusBar(): StatusBar {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.name = PRODUCT;
	item.command = COMMANDS.showMenu;
	const visibleStatus = createVisibleStatus();

	// Logged here rather than beside the connection, so what a reader sees in the
	// output channel is word for word what the tooltip beside them says.
	const update = (status: ConnectionStatus, board?: BoardVersion) => {
		const { text, tooltip, summary } = describeStatus(visibleStatus(status), board);
		item.text = text;
		item.tooltip = tooltip;
		log(`Board status: ${summary}`);
	};

	update(ConnectionStatus.NoAuthorizedDevice);
	item.show();
	return { update, dispose: () => item.dispose() };
}
