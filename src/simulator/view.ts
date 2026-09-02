/**
 * The only file that knows what a `WebviewView` is. Everything below it is
 * written against a plain `vscode.Webview`, which is what a view hands out.
 */
import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { log } from '../log';
import { readSimulatorHtml, simulatorAssets } from './assets';
import { simulatorDocument } from './content';
import type { FromShell } from './protocol';

export const VIEW_ID = 'bbcmicrobit-micropython.simulator';

export interface Simulator extends vscode.Disposable {
	/** Reveals the one view there is, resolving it if it has never been shown. */
	show(): Promise<void>;
}

/**
 * The current view hangs off this rather than off a module variable: a module
 * singleton survives `deactivate()`, so a second activation in the same host,
 * which is what the integration tests do, would inherit the first one's view.
 */
export function createSimulator(context: vscode.ExtensionContext): Simulator {
	let current: vscode.WebviewView | undefined;

	const provider: vscode.WebviewViewProvider = {
		resolveWebviewView(view) {
			current = view;
			// A move to another container or a window reload disposes the view and
			// resolves a fresh one; hiding does not. Neither is an error.
			view.onDidDispose(() => {
				if (current === view) current = undefined;
			});

			view.webview.options = {
				enableScripts: true,
				localResourceRoots: [
					simulatorAssets(context.extensionUri),
					vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
				],
			};
			view.webview.onDidReceiveMessage((message: FromShell) => {
				// Unknown kinds are ignored rather than thrown on, so a simulator bump
				// that adds a message does not break an older extension.
				if (message?.kind === 'failed') {
					log(`Simulator failed: ${message.detail}`);
					// A board that renders and cannot run is worse than one that says so:
					// upstream reports `ready` before it ever touches the WebAssembly, so
					// this is the only warning a broken load gives.
					view.webview.html = failed();
				} else if (message?.kind === 'error') log(`Simulator error: ${message.detail}`);
				else if (message?.kind === 'notification') log(`Simulator: ${message.notification.kind}`);
				else if (message?.kind === 'control') log(`Simulator: ${message.control} pressed`);
				else if (message?.kind === 'ready') log('Simulator: the view is up');
			});

			void load(context, view.webview);
		},
	};

	const registration = vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
		// Not optional: without it the document is deallocated when the view is
		// hidden and rebuilt when it returns, so the running program is gone.
		webviewOptions: { retainContextWhenHidden: true },
	});
	context.subscriptions.push(registration);

	return {
		dispose: () => registration.dispose(),
		show: async () => {
			// `<viewId>.focus` is VS Code's own, and the only way to reveal a view
			// that has never been resolved and so has no `show()` to call.
			if (current) current.show(true);
			else await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		},
	};
}

async function load(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<void> {
	try {
		const upstream = await readSimulatorHtml(context.extensionUri);
		webview.html = simulatorDocument(upstream, {
			assets: webview.asWebviewUri(simulatorAssets(context.extensionUri)).toString(),
			script: webview
				.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'simulator.js'))
				.toString(),
			cspSource: webview.cspSource,
		});
	} catch (error) {
		// A blank view is indistinguishable from a hang, so say so in the view and
		// leave the detail where a user can read it.
		log(`Could not load the simulator: ${String(error)}`);
		webview.html = failed();
	}
}

function failed(): string {
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="font-family: var(--vscode-font-family); padding: 12px">
<p>The simulator could not be loaded.</p>
<p>See the <b>${PRODUCT}</b> output channel for the reason.</p>
</body></html>`;
}
