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
import { clearValue, sensorControls, setValueFor, withChange, type Control } from '../simulator/sensors';
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
	} else if (message.kind === 'terminal') setTerminalOpen(message.open);
}

/** Kept apart from the button: the host may say so before there is a body to show it in. */
let terminalOpen = false;

/** Greyed out while a terminal is open, which is also how the strip says there is one. */
function setTerminalOpen(open: boolean): void {
	terminalOpen = open;
	terminal?.toggleAttribute('disabled', open);
	if (terminal) terminal.title = open ? 'A serial terminal is already open.' : 'Open a serial terminal on the board.';
}

/**
 * Stop is greyed out while there is nothing to stop. Tracked from our own
 * actions, since the board announces neither a start nor a stop; a panic leaves
 * it enabled, and a Stop then does nothing, which is harmless.
 */
function setRunning(running: boolean): void {
	stop?.toggleAttribute('disabled', !running);
	// A stopped board has no interpreter to receive a value.
	for (const field of fields.values()) field.input.toggleAttribute('disabled', !running);
	for (const send of sendButtons) send.toggleAttribute('disabled', !running);
	panel?.classList.toggle('disabled', !running);
}

/** The play button's `request_flash` goes up to the extension, which answers with `files`. */
function fromSimulator(notification: SimulatorMessage): void {
	if (notification.kind === 'request_flash') {
		started = true;
		if (note) note.hidden = true;
	}
	// The board's own ranges and choices arrive once, at boot, and nowhere else.
	if (notification.kind === 'ready') buildSensors(notification.state);
	if (notification.kind === 'state_change') followProgram(notification.change);
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
let terminal: HTMLButtonElement | undefined;
let note: HTMLElement | undefined;

window.addEventListener('DOMContentLoaded', () => {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);
	document.body.append(controls(), loadedNote());
	// The board boots with the document, so its state can arrive before this runs.
	if (boardState !== undefined) buildSensors(boardState);
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

	// The extension opens it: the terminal is Eclipse's, in another part of the window.
	terminal = button('Terminal', () => send({ kind: 'control', control: 'terminal' }));
	setTerminalOpen(terminalOpen);
	strip.append(terminal);

	return strip;
}

/**
 * The sensor panel. Built from the board's own `ready` state, so a simulator that
 * gains a sensor gains a control; what to show is decided in `sensors.ts`, and
 * this file is only the DOM.
 */
let boardState: unknown;
let sensors: Control[] = [];
let panel: HTMLElement | undefined;
const fields = new Map<string, { input: HTMLInputElement | HTMLSelectElement; readout?: HTMLElement }>();
const sendButtons: HTMLButtonElement[] = [];

function buildSensors(state: unknown): void {
	boardState = state;
	// The board's state can arrive before the strip exists, since `body` is there
	// from the first parsed tag. Building then would put the panel above the strip
	// and leave it enabled with no board, so it waits for `DOMContentLoaded`, which
	// builds from what was kept here.
	if (!note) return;
	try {
		sensors = sensorControls(state);
		fields.clear();
		sendButtons.length = 0;
		const built = sensorPanel(sensors);
		panel ? panel.replaceWith(built) : note.after(built);
		panel = built;
		setRunning(!stop?.hasAttribute('disabled'));
	} catch (error) {
		// The panel is worth losing; the board is not.
		send({ kind: 'error', detail: `the sensor panel could not be built: ${String(error)}` });
	}
}

/** A change the program made, which must never be posted back to it. */
function followProgram(change: unknown): void {
	sensors = withChange(sensors, change);
	for (const control of sensors) {
		const field = fields.get(control.id);
		if (!field) continue;
		// A checkbox carries its state in `checked`; `value` there is what a form
		// would submit, and setting it would do nothing at all.
		if (field.input instanceof HTMLInputElement && field.input.type === 'checkbox') {
			field.input.checked = control.value === 1;
		} else {
			field.input.value = String(control.value);
		}
		if (field.readout) field.readout.textContent = readout(control);
	}
}

function sensorPanel(list: Control[]): HTMLElement {
	const details = document.createElement('details');
	details.className = 'sensors';
	const summary = document.createElement('summary');
	summary.textContent = 'Sensors';
	details.append(summary);
	if (!list.length) {
		const empty = document.createElement('p');
		empty.className = 'note';
		empty.textContent = 'This simulator reports no sensors.';
		details.append(empty);
		return details;
	}
	for (const control of list) details.append(row(control));
	return details;
}

const readout = (control: Control): string =>
	control.kind === 'slider' && control.unit ? `${control.value} ${control.unit}` : String(control.value);

/** A label wrapping its own control, so the two are bound with no ids to collide. */
function row(control: Control): HTMLElement {
	if (control.kind === 'enum') return enumRow(control);

	const label = document.createElement('label');
	label.className = 'sensor';
	const name = document.createElement('span');
	name.className = 'sensor-name';
	name.textContent = control.label;
	label.append(name);

	const input = document.createElement('input');
	if (control.kind === 'toggle') {
		label.classList.add('toggle');
		input.type = 'checkbox';
		input.checked = control.value === 1;
		input.addEventListener('change', () => post(control, input.checked ? 1 : 0));
		label.prepend(input);
		fields.set(control.id, { input });
		return label;
	}

	const value = document.createElement('span');
	value.className = 'sensor-value';
	value.textContent = readout(control);
	name.append(' ', value);

	input.type = 'range';
	input.min = String(control.min);
	input.max = String(control.max);
	// Whole numbers only: upstream `parseInt`s a string value and rejects a
	// fraction that then reads as a slider that jumps.
	input.step = '1';
	input.value = String(control.value);
	input.addEventListener('input', () => {
		const sent = post(control, input.value);
		value.textContent = control.unit ? `${sent} ${control.unit}` : String(sent);
	});
	label.append(input);
	fields.set(control.id, { input, readout: value });
	return label;
}

/**
 * A gesture is an event and not a level: it is sent, then cleared 500 ms later,
 * or the board reads as being shaken for ever and a second shake never fires.
 */
function enumRow(control: Control & { kind: 'enum' }): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.className = 'sensor enum';

	const label = document.createElement('label');
	label.className = 'sensor-name';
	label.textContent = control.label;
	const select = document.createElement('select');
	for (const choice of control.choices) {
		const option = document.createElement('option');
		option.value = choice;
		option.textContent = choice;
		option.selected = choice === control.value;
		select.append(option);
	}
	label.append(select);
	wrapper.append(label);

	const fire = button('Send', () => {
		post(control, select.value);
		fire.setAttribute('disabled', '');
		setTimeout(() => {
			post(control, clearValue(control));
			fire.removeAttribute('disabled');
		}, 500);
	});
	sendButtons.push(fire);
	wrapper.append(fire);
	fields.set(control.id, { input: select });
	return wrapper;
}

/** Our own copy moves with it: the board never echoes a `set_value` back. */
function post(control: Control, raw: number | string): number | string {
	const message = setValueFor(control, raw);
	toSimulator(message);
	const sent = message.value as number | string;
	const at = sensors.findIndex((entry) => entry.id === control.id);
	if (at !== -1) sensors[at] = { ...sensors[at], value: sent } as Control;
	return sent;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
	const element = document.createElement('button');
	element.type = 'button';
	element.textContent = label;
	element.addEventListener('click', onClick);
	return element;
}
