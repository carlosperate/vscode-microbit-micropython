/** The desktop entry point, loaded in the Node host. */
import type * as vscode from 'vscode';

import { activateHost, type ExtensionApi } from '../activate';

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	return activateHost(context, 'node');
}

export function deactivate(): void {}
