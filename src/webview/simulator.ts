/**
 * Our half of the simulator document; upstream's page is the other half in the
 * same window. The extension reaches us over `webview.postMessage`, and we reach
 * the simulator over `window.postMessage`, since it posts at `window.parent`,
 * which the prelude points back at this window, and accepts only that source.
 */
import {
	FROM_SHELL,
	RUNTIME_FILES,
	isMessage,
	toFilesystem,
	type FromShell,
	type SimulatorMessage,
	type ToShell,
} from '../simulator/protocol';
import css from './simulator.css';

// Prelude. Runs before upstream's scripts, which is the whole reason this file
// is a blocking script in <head> and touches no DOM: there is no body yet.

// `Notifications` captures window.parent once, at construction, and 1.91.1
// leaves it undefined: the first notification throws without this.
(window as { parent: Window }).parent = window;

// Upstream unregisters the service worker controlling its document and reloads;
// here that worker serves every webview file. Only the method it asks is stubbed.
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

	// Upstream posts to this window; the extension's messages come from VS Code's host frame.
	if (event.source === window) fromSimulator(data);
	else fromHost(data as ToShell);
});

/**
 * Files run at once on a started board. Before the first click they cannot: a
 * `flash` then kills the board for good, so the note points at the play button.
 */
function fromHost(message: ToShell): void {
	if (message.kind === 'command') toSimulator(message.command);
	else if (message.kind === 'files') {
		if (started) {
			toSimulator({ kind: 'flash', filesystem: toFilesystem(message.files) });
			setRunning(true);
			// Only now has something run that a Reset could bring back.
			reset?.removeAttribute('disabled');
		} else if (note) note.hidden = false;
	}
}

/**
 * Stop is greyed out while there is nothing to stop. Tracked from our own
 * actions, since the board announces neither a start nor a stop; a panic leaves
 * it enabled, and a Stop then does nothing, which is harmless.
 */
function setRunning(running: boolean): void {
	stop?.toggleAttribute('disabled', !running);
}

/** The play button's `request_flash` goes up to the extension, which answers with `files`. */
function fromSimulator(notification: SimulatorMessage): void {
	if (notification.kind === 'request_flash') {
		started = true;
		if (note) note.hidden = true;
	}
	// An Error crosses the channel as `{}`, so its message goes instead.
	if (notification.kind === 'internal_error') {
		const error = notification.error as { message?: string } | undefined;
		notification = { ...notification, error: String(error?.message ?? error) };
	}
	send({ kind: 'notification', notification });
}

// A real document, unlike the extension host, so these fire. Logged, never fatal:
// they miss the one failure that kills a board, and a stray rejection is survivable.
window.addEventListener('error', (event) => send({ kind: 'error', detail: String(event.message) }));
window.addEventListener('unhandledrejection', (event) =>
	send({ kind: 'error', detail: String((event as PromiseRejectionEvent).reason) })
);

let stop: HTMLButtonElement | undefined;
let reset: HTMLButtonElement | undefined;
let note: HTMLElement | undefined;

window.addEventListener('DOMContentLoaded', () => {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);
	document.body.append(controls(), loadedNote());
	send({ kind: 'ready' });
	flush();
	void checkAssets();
});

/**
 * Upstream reports `ready` before it needs its files, its failed fetches reach no
 * listener here, and on web the host's stat cannot tell a missing file. So the
 * shell fetches every runtime file itself; upstream has just loaded them.
 */
async function checkAssets(): Promise<void> {
	// Not simulator.html: it is this document, already read by the host.
	for (const file of RUNTIME_FILES.filter((name) => name !== 'simulator.html')) {
		try {
			const response = await fetch(new URL(file, document.baseURI));
			if (response.ok) continue;
			send({ kind: 'failed', detail: `${file} answered ${response.status}` });
		} catch (error) {
			send({ kind: 'failed', detail: `${file} could not be read: ${String(error)}` });
		}
		return;
	}
}

/** Run in Simulator on a board that has never started must not look like nothing happened. */
function loadedNote(): HTMLElement {
	note = document.createElement('p');
	note.className = 'note';
	note.textContent = 'Press the play button on the board to run your program.';
	note.hidden = true;
	return note;
}

function controls(): HTMLElement {
	const strip = document.createElement('div');
	strip.className = 'controls';

	// No Run here: the board's own play button shows whenever it is stopped and
	// always loads the latest workspace files, so Stop then play re-runs.
	stop = button('Stop', () => {
		toSimulator({ kind: 'stop' });
		setRunning(false);
		send({ kind: 'control', control: 'stop' });
	});
	stop.setAttribute('disabled', '');
	strip.append(stop);

	// Disabled until something has run: `reset()` calls `start()`, which builds a
	// module, and that throws for good on a board whose play button was never pressed.
	reset = button('Reset', () => {
		toSimulator({ kind: 'reset' });
		setRunning(true);
		send({ kind: 'control', control: 'reset' });
	});
	reset.setAttribute('disabled', '');
	strip.append(reset);

	// Labelled with the action, not the state: a button that offers Mute already
	// says the sound is on, and `aria-pressed` on an action label reads backwards.
	let muted = false;
	const sound = button('Mute', () => {
		muted = !muted;
		toSimulator({ kind: muted ? 'mute' : 'unmute' });
		sound.textContent = muted ? 'Unmute' : 'Mute';
		send({ kind: 'control', control: 'sound', on: !muted });
	});
	strip.append(sound);

	return strip;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
	const element = document.createElement('button');
	element.type = 'button';
	element.textContent = label;
	element.addEventListener('click', onClick);
	return element;
}
