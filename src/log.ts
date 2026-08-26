import * as vscode from 'vscode';

import { PRODUCT } from './config';

/**
 * The Web Worker console is unreliable, so diagnostics use one output channel.
 * Context ownership also disposes it when activation fails before `deactivate`.
 */
let channel: vscode.OutputChannel | undefined;

export function createLog(context: vscode.ExtensionContext): void {
	channel = vscode.window.createOutputChannel(PRODUCT);
	context.subscriptions.push(channel, {
		dispose: () => {
			channel = undefined;
		},
	});
}

export function log(message: string): void {
	channel?.appendLine(message);
}
