/**
 * Our half of the simulator document. Upstream's page is the other half, and
 * both run in this one window, so every message is one hop:
 *
 *   extension host ⇄ webview.postMessage / onDidReceiveMessage ⇄ this shell
 *   this shell     ⇄ window.postMessage / 'message'            ⇄ the simulator
 *
 * The simulator posts at `window.parent` and accepts only
 * `e.source === window.parent`, so with the prelude below pointing that back at
 * this window, the two halves talk by posting to their own window.
 */
import { FROM_SHELL, isMessage, type FromShell, type SimulatorMessage, type ToShell } from '../simulator/protocol';
import css from './simulator.css';

// Prelude. Runs before upstream's scripts, which is the whole reason this file
// is a blocking script in <head> and touches no DOM: there is no body yet.

// `Notifications` captures window.parent once, at construction, and 1.91.1
// leaves it undefined: the first notification throws without this.
(window as { parent: Window }).parent = window;

// Upstream unregisters whatever service worker controls its document and then
// reloads. Here that worker serves every webview resource, so the one method it
// asks is overridden to find nothing; the rest of the container stays real.
if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = () => Promise.resolve(undefined);

const vscode = acquireVsCodeApi();

/**
 * Anything posted while upstream's scripts are still running is lost: the
 * extension side of the channel is not up until the document is. Measured with a
 * missing `firmware.wasm`, whose failure was reported and never arrived.
 */
let queue: FromShell[] | undefined = [];

function send(message: FromShell): void {
	if (queue) queue.push(message);
	else vscode.postMessage(message);
}

function flush(): void {
	const queued = queue ?? [];
	queue = undefined;
	for (const message of queued) vscode.postMessage(message);
}

/** Into the simulator, which is this same window, tagged so we skip it coming back. */
const toSimulator = (message: SimulatorMessage) => window.postMessage({ ...message, [FROM_SHELL]: true }, '*');

/** Only after the board has asked to be flashed, which is the first user click. */
let started = false;

window.addEventListener('message', (event: MessageEvent) => {
	const data: unknown = event.data;
	if (!isMessage(data)) return;
	if (data[FROM_SHELL]) return;

	const inbound = data as ToShell & SimulatorMessage;
	if (inbound.kind === 'command') {
		toSimulator(inbound.command);
		return;
	}

	// Anything else on this window is the simulator talking.
	if (data.kind === 'request_flash') {
		started = true;
		reset?.removeAttribute('disabled');
	}
	send({ kind: 'notification', notification: data });
});

// A real document, unlike the extension host, so these actually fire. Logged and
// never fatal: they do not see the one failure that kills a board, and a stray
// rejection, such as audio resume on a host with no output, leaves it runnable.
window.addEventListener('error', (event) => send({ kind: 'error', detail: String(event.message) }));
window.addEventListener('unhandledrejection', (event) =>
	send({ kind: 'error', detail: String((event as PromiseRejectionEvent).reason) })
);

let reset: HTMLButtonElement | undefined;

window.addEventListener('DOMContentLoaded', () => {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);
	document.body.append(controls());
	send({ kind: 'ready' });
	flush();
	void checkFirmware();
});

/**
 * The board renders and reports `ready` whether or not the WebAssembly is there,
 * and upstream's own failure to fetch it reaches no error listener, so this is
 * the only thing between a missing file and a board that dies on first run.
 * Upstream has already fetched it by now, so this is a cache hit.
 */
async function checkFirmware(): Promise<void> {
	const url = new URL('build/firmware.wasm', document.baseURI);
	try {
		const response = await fetch(url);
		if (!response.ok) send({ kind: 'failed', detail: `firmware.wasm answered ${response.status}` });
	} catch (error) {
		send({ kind: 'failed', detail: `firmware.wasm could not be read: ${String(error)}` });
	}
}

function controls(): HTMLElement {
	const strip = document.createElement('div');
	strip.className = 'controls';

	strip.append(
		button('Stop', () => {
			toSimulator({ kind: 'stop' });
			send({ kind: 'control', control: 'stop' });
		})
	);

	// `reset()` is `stop(true)` then `start()`, and `start()` builds a module,
	// which throws on a board whose play button has never been pressed and leaves
	// a rejected promise that kills it permanently. Stop and Sound are safe:
	// neither builds a module.
	reset = button('Reset', () => {
		toSimulator({ kind: 'reset' });
		send({ kind: 'control', control: 'reset' });
	});
	if (!started) reset.setAttribute('disabled', '');
	strip.append(reset);

	let sound = true;
	const soundButton = button('Sound', () => {
		sound = !sound;
		toSimulator({ kind: sound ? 'unmute' : 'mute' });
		// A toggle, so a screen reader has no other way to know which way it is set.
		soundButton.setAttribute('aria-pressed', String(sound));
		soundButton.textContent = sound ? 'Sound' : 'Muted';
		send({ kind: 'control', control: 'sound', on: sound });
	});
	soundButton.setAttribute('aria-pressed', 'true');
	strip.append(soundButton);

	return strip;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
	const element = document.createElement('button');
	element.type = 'button';
	element.textContent = label;
	element.addEventListener('click', onClick);
	return element;
}
