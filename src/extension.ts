import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('microbit-micropython.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from micro:bit MicroPython!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
