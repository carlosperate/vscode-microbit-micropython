/** The web entry point, loaded in a Web Worker. */
import type * as vscode from 'vscode';

import { activateHost, type ExtensionApi } from '../activate';

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	return activateHost(context, 'browser');
}

export function deactivate(): void {}
