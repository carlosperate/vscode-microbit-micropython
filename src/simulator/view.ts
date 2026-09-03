/**
 * The only file that knows what a `WebviewView` is. Everything below it is
 * written against a plain `vscode.Webview`, which is what a view hands out.
 */
import * as vscode from 'vscode';

import { COMMANDS, PRODUCT } from '../config';
import { log } from '../log';
import type { SerialTransport } from '../serial/types';
import { readSimulatorHtml, simulatorAssets } from './assets';
import { SimulatorTransport, type SimulatorLink } from './connection';
import { simulatorDocument } from './content';
import type { EncodedFile, FromShell, SimulatorMessage, ToShell } from './protocol';
import { ReadyGate, type Readiness } from './ready';

export const VIEW_ID = 'bbcmicrobit-micropython.simulator';

/** Generous: the shell reports at DOMContentLoaded, long before any WebAssembly runs. */
const READY_TIMEOUT_MS = 10 * 1000;

/** One line per serial write, sensor tick, log row or radio packet would bury the channel. */
const UNLOGGED = new Set(['serial_output', 'state_change', 'log_output', 'radio_output']);

export interface Simulator extends vscode.Disposable {
	/** Reveals the one view there is, resolving it if it has never been shown. */
	show(): Promise<void>;
	/** Waits for the document, or for the reason there is not going to be one. */
	ready(): Promise<Readiness>;
	/** Waits for the document and hands it the files; the caller reveals first. */
	run(files: EncodedFile[]): Promise<Readiness>;
	/** The board's serial port, alive across every document the view resolves. */
	serial: SerialTransport;
}

/** The workspace files for the board, or nothing once the user has been told why not. */
export type ProvideFiles = () => Promise<EncodedFile[] | undefined>;

/**
 * The current view hangs off this rather than off a module variable: a module
 * singleton survives `deactivate()`, so a second activation in the same host,
 * which is what the integration tests do, would inherit the first one's view.
 */
export function createSimulator(context: vscode.ExtensionContext, provideFiles: ProvideFiles): Simulator {
	let current: vscode.WebviewView | undefined;
	const gate = new ReadyGate();

	// The terminal outlives any one document, so it listens here and not on a webview.
	const messageListeners = new Set<(message: FromShell) => void>();
	const disposeListeners = new Set<() => void>();
	const link: SimulatorLink = {
		onMessage: (listener) => {
			messageListeners.add(listener);
			return () => messageListeners.delete(listener);
		},
		onDisposed: (listener) => {
			disposeListeners.add(listener);
			return () => disposeListeners.delete(listener);
		},
		// Nothing to post to between documents, and nothing is lost: a disposal has
		// already ended whatever was writing. A rejection is logged, or the host swallows it.
		post: (message) => {
			void current?.webview
				.postMessage(message)
				.then(undefined, (error: unknown) => log(`Simulator: a message could not be posted: ${String(error)}`));
		},
	};

	const provider: vscode.WebviewViewProvider = {
		resolveWebviewView(view) {
			current = view;
			// A move to another container or a window reload disposes the view and
			// resolves a fresh one; hiding does not. Neither is an error.
			view.onDidDispose(() => {
				if (current !== view) return;
				current = undefined;
				gate.reset();
				for (const listener of disposeListeners) listener();
			});

			view.webview.options = {
				enableScripts: true,
				localResourceRoots: [
					simulatorAssets(context.extensionUri),
					vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
				],
			};
			view.webview.onDidReceiveMessage((message: FromShell) => {
				receive(view.webview, message);
				for (const listener of messageListeners) listener(message);
			});

			void load(view.webview);
		},
	};

	function receive(webview: vscode.Webview, message: FromShell): void {
		// Unknown kinds fall through untouched, so a simulator bump that adds a
		// message does not break an older extension.
		switch (message?.kind) {
			case 'ready':
				log('Simulator: the view is up');
				gate.settle({ kind: 'ready' });
				return;
			case 'failed':
				log(`Simulator failed: ${message.detail}`);
				fail(webview, message.detail);
				return;
			case 'error':
				log(`Simulator error: ${message.detail}`);
				return;
			case 'control':
				log(`Simulator: ${message.control} pressed`);
				// The strip's button runs the same command as the palette, so the two cannot drift.
				if (message.control === 'terminal') {
					void vscode.commands
						.executeCommand(COMMANDS.openSimulatorTerminal)
						.then(undefined, (error: unknown) => log(`Simulator: the terminal button failed: ${String(error)}`));
				}
				return;
			case 'notification':
				logNotification(message.notification);
				if (message.notification.kind === 'request_flash') void sendFiles(webview);
				return;
		}
	}

	/**
	 * The board's own play button runs the workspace, so it asks for the files
	 * the way the command does; a refusal has already said why.
	 */
	async function sendFiles(webview: vscode.Webview): Promise<void> {
		const files = await provideFiles();
		if (!files) return;
		// `false`, not a throw, when the view has gone in the meantime.
		if (!(await webview.postMessage({ kind: 'files', files } satisfies ToShell))) {
			log('Simulator: the files could not be delivered, the view has gone');
		}
	}

	async function load(webview: vscode.Webview): Promise<void> {
		gate.reset();
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
			log(`Could not load the simulator: ${String(error)}`);
			fail(webview, String(error));
		}
	}

	/** A blank view is indistinguishable from a hang, so the view says so and the gate says why. */
	function fail(webview: vscode.Webview, detail: string): void {
		gate.settle({ kind: 'failed', detail });
		webview.html = failed();
	}

	const registration = vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
		// Not optional: without it the document is deallocated when the view is
		// hidden and rebuilt when it returns, so the running program is gone.
		webviewOptions: { retainContextWhenHidden: true },
	});
	context.subscriptions.push(registration);

	async function show(): Promise<void> {
		// `<viewId>.focus` is VS Code's own, and the only way to reveal a view
		// that has never been resolved and so has no `show()` to call.
		if (!current) {
			await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
			return;
		}
		current.show(true);
		// A retained view is never resolved again on its own, so revealing retries a failed load.
		if (gate.current()?.kind === 'failed') void load(current.webview);
	}

	const ready = () => gate.wait(READY_TIMEOUT_MS);

	return {
		dispose: () => registration.dispose(),
		show,
		ready,
		run: async (files) => {
			const outcome = await ready();
			if (outcome.kind !== 'ready') return outcome;
			const webview = current?.webview;
			if (!webview) return { kind: 'failed', detail: 'the view went away while it was loading' };
			// `false`, not a throw, when the view has gone in the meantime.
			if (!(await webview.postMessage({ kind: 'files', files } satisfies ToShell))) {
				return { kind: 'failed', detail: 'the files could not be delivered, the view has gone' };
			}
			return outcome;
		},
		serial: new SimulatorTransport(link),
	};
}

function logNotification(notification: SimulatorMessage): void {
	if (UNLOGGED.has(notification.kind)) return;
	if (notification.kind === 'internal_error') log(`Simulator internal error: ${String(notification.error)}`);
	else log(`Simulator: ${notification.kind}`);
}

function failed(): string {
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="font-family: var(--vscode-font-family); padding: 12px">
<p>The simulator could not be loaded.</p>
<p>See the <b>${PRODUCT}</b> output channel for the reason.</p>
</body></html>`;
}
