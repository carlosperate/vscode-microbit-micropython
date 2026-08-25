import * as vscode from 'vscode';

import { OUTPUT_CHANNEL } from './config';

/**
 * The one output channel, and the instrument to reach for when something goes
 * wrong. Extensions run in a Web Worker whose `console` output does not reliably
 * reach the page console, so anything worth reading later goes here instead.
 *
 * Owned by `context.subscriptions` rather than by `deactivate`, which VS Code
 * does not call for an extension whose activation threw. A channel tied only to
 * `deactivate` outlives such a failure and sits orphaned in the Output dropdown.
 */
let channel: vscode.OutputChannel | undefined;

export function createLog(context: vscode.ExtensionContext): void {
	channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
	context.subscriptions.push(channel, {
		dispose: () => {
			channel = undefined;
		},
	});
}

export function log(message: string): void {
	channel?.appendLine(message);
}
