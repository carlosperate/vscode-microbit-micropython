/**
 * The one WebUSB connection this extension owns, and the seam every command that
 * needs a board goes through. Module level for the same reason the output
 * channel is: a command handler has no other way to reach it.
 */
import {
	ConnectionStatus,
	type BoardVersion,
	type FlashDataSource,
	type ProgressCallback,
} from '@microbit/microbit-connection';
import {
	createUSBConnection,
	DeviceSelectionMode,
	type MicrobitUSBConnection,
} from '@microbit/microbit-connection/usb';
import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { log } from '../log';
import { SerialWriteGate } from '../serial/transport';
import type { SerialTransport } from '../serial/types';
import {
	BOARD_CHANGED,
	CHOOSER_REFUSED,
	describeError,
	explainDevice,
	NO_PAIRING,
	NO_WEBUSB,
	NOT_A_MICROBIT,
	WRONG_BOARD,
} from '../ui/errors';
import { createStatusBar, type StatusBar } from '../ui/statusbar';
import { connectToBoard, isMicrobit, MICROBIT_FILTER, type Outcome, type UsbIdentity } from './connect';

/**
 * VS Code's bridge for `requestDevice`, which is `Window`-only and so out of
 * reach from a worker. **Only the web workbench registers it**: desktop carries
 * the class that would and never instantiates it, so a board can be used there
 * and never authorised.
 */
export const REQUEST_USB_DEVICE = 'workbench.experimental.requestUsbDevice';

/** The statuses a board was reachable in, so losing one is worth reacting to. */
const LIVE: ConnectionStatus[] = [ConnectionStatus.Connected, ConnectionStatus.Paused];

/** The statuses with nothing to disconnect from. */
const IDLE: ConnectionStatus[] = [ConnectionStatus.NoAuthorizedDevice, ConnectionStatus.Disconnected];

/**
 * A device is absent from `getDevices()` for the whole turn its own disconnect
 * event fires, so a check made there finds nothing every time. Waiting is what
 * tells a reset that comes straight back from a cable pulled out.
 */
const RESETTLE_MS = 1500;

/**
 * How much of a flash has to pass before the library calls back again. Its
 * default of 0.0025 is about 400 crossings of the worker boundary for a bar
 * nobody can read that fast; this gives 50 and a smooth one.
 */
const PROGRESS_STEP = 0.02;

let connection: MicrobitUSBConnection | undefined;
let serialTransport: SerialWriteGate | undefined;
let statusBar: StatusBar | undefined;
let recovering = false;

/**
 * The connect in flight, which every question about whether there is a board has
 * to consult: USB never reports `Connecting`, so the library's own status stays
 * at its previous value throughout one.
 */
let attempt: Promise<Attempted> | undefined;

/** Asked for back mid-connect. A chooser is the host's window and cannot be closed from here. */
let releaseWhenIdle = false;

/**
 * The flash in flight. Taking the device away during one leaves the board halted
 * part-written, and the library's own cleanup dereferences the device it no
 * longer has, so everything that could disconnect has to see this.
 */
let writing: Promise<boolean> | undefined;

/** A finished attempt, either way, since callers word failure differently. */
type Attempted = { outcome: Outcome } | { error: unknown };

/**
 * Whether the bridge is registered, answered once at activation because
 * `getCommands` is an await and nothing registers it later. `undefined` reads as
 * "probably yes": a wrong refusal lasts the session, a wrong yes costs one call.
 */
let bridged: boolean | undefined;

/**
 * Builds the connection, shows the status bar, and reconnects to a board that is
 * already authorised. `getDevices()` needs no user gesture, so a returning user
 * is connected before they ask for it.
 */
export function createBoard(context: vscode.ExtensionContext): void {
	const bar = createStatusBar();
	const board = createUSBConnection({
		logging: {
			log: (entry) => log(`Board: ${String(entry)}`),
			error: (message, error) => log(`Board: ${message}: ${String(error)}`),
			event: (entry) => log(`Board: ${entry.type}${entry.message ? ` ${entry.message}` : ''}`),
		},
		// Try every authorised device before asking, since the asking is what this
		// host cannot do. The guard below is what keeps it from ever getting there.
		deviceSelectionMode: DeviceSelectionMode.UseAnyAllowed,
		// A worker has no document to go hidden, so this only ever costs a listener.
		pauseOnHidden: false,
	});

	const onStatus = ({ status, previousStatus }: { status: ConnectionStatus; previousStatus: ConnectionStatus }) => {
		bar.update(status, versionOf(board));
		if (status !== ConnectionStatus.NoAuthorizedDevice || !LIVE.includes(previousStatus)) return;

		// Read here rather than inside `recover`, which waits before it looks: a
		// cable pulled mid-flash reports its own failure and is already unwinding,
		// and a second message plus a reconnect racing that unwind helps nobody.
		if (!writing) void recover(board);
	};
	board.addEventListener('status', onStatus);
	board.addEventListener('beforerequestdevice', chooserWasReached);
	const transport = new SerialWriteGate({
		onData: (listener) => {
			const wrapped = ({ data }: { data: string }) => listener(data);
			board.addEventListener('serialdata', wrapped);
			return () => board.removeEventListener('serialdata', wrapped);
		},
		onDisconnect: (listener) => {
			const wrapped = () => {
				if (!boardAttached()) listener();
			};
			board.addEventListener('status', wrapped);
			return () => board.removeEventListener('status', wrapped);
		},
		write: async (data) => {
			if (board.status === ConnectionStatus.Connected) await board.serialWrite(data);
		},
	});

	connection = board;
	serialTransport = transport;
	statusBar = bar;
	context.subscriptions.push({
		dispose: () => {
			connection = undefined;
			serialTransport = undefined;
			statusBar = undefined;
			board.removeEventListener('status', onStatus);
			board.removeEventListener('beforerequestdevice', chooserWasReached);
			board.dispose();
			bar.dispose();
		},
	});

	// A `Thenable` has no `catch`, so the failure handler is the second argument.
	// Unhandled it would be invisible: the worker never fires `unhandledrejection`,
	// so nothing anywhere would say the probe failed.
	void vscode.commands.getCommands(true).then(
		(registered) => {
			bridged = registered.includes(REQUEST_USB_DEVICE);
			log(bridged ? 'This host can pair a micro:bit' : 'This host can only use a micro:bit something else authorised');
		},
		(error: unknown) => log(`Could not tell whether this host can pair a micro:bit: ${describeError(error)}`)
	);

	void start(board);
}

/**
 * `initialize()` attaches the disconnect listener everything else here reacts to,
 * and reads `navigator.usb` unguarded, which some privacy extensions replace
 * with a throwing getter. Its failure must not take the silent connect with it.
 */
async function start(board: MicrobitUSBConnection): Promise<void> {
	try {
		await board.initialize();
	} catch (error) {
		log(`The board connection could not be initialised: ${describeError(error)}`);
	}
	await connectSilently(board);
}

/**
 * Hands the board back before the host goes away. `deactivate`'s to call and not
 * a subscription's: `dispose()` is synchronous, so a disconnect started there is
 * abandoned and the next window finds the interface still claimed.
 */
export async function shutdownBoard(): Promise<void> {
	const board = connection;
	if (!board) return;

	await withSerialWritesBlocked(async () => {
		// Let a flash finish rather than pulling the device out from under it.
		await writing?.then(undefined, () => undefined);

		// A connect still running would otherwise land after this returns.
		if (attempt) releaseWhenIdle = true;
		if (IDLE.includes(board.status)) return;

		try {
			await board.disconnect();
		} catch (error) {
			log(`Could not hand the micro:bit back on shutdown: ${describeError(error)}`);
		}
	});
}

/**
 * Dispatched as the first statement of the library's own `chooseDevice()`, which
 * calls a `requestDevice` that does not exist here and fails as `requestDevice is
 * not a function` with nothing to say where it came from. Throwing names it, and
 * the library disconnects cleanly around it.
 */
function chooserWasReached(): never {
	const message =
		'The device chooser was reached inside the extension host, where it does not exist. Pairing goes through ' +
		'VS Code, so something asked the connection to find a board with none authorised.';
	log(message);
	throw new Error(message);
}

/**
 * Connect, pairing first when nothing is authorised yet. A `false` has already
 * been reported, or was a cancellation needing no report, so a caller can stop.
 * Every route to a board comes through here, flashing included: the library's
 * `flash()` connects on its own and would meet the same unreachable chooser.
 */
export async function connectBoard(): Promise<boolean> {
	const board = connection;
	if (!board) return false;
	if (board.status === ConnectionStatus.Connected) return true;

	// Otherwise a Firefox-shaped failure reads as a blocked chooser, not this.
	if (!(await usbAvailable())) {
		warn(NO_WEBUSB);
		return false;
	}

	const attempted = await connectOnce(board, true);
	if ('error' in attempted) {
		log(`Could not connect: ${describeError(attempted.error)}`);
		warn(explainDevice(attempted.error));
		return false;
	}

	return report(board, attempted.outcome);
}

export async function disconnectBoard(): Promise<void> {
	const board = connection;
	if (!board || (IDLE.includes(board.status) && !attempt && !writing)) {
		void vscode.window.showInformationMessage(`${PRODUCT}: no micro:bit is connected.`);
		return;
	}

	// Taking the device away mid-write leaves the board halted and part-written.
	if (writing) {
		void vscode.window.showWarningMessage(
			`${PRODUCT}: copying to the micro:bit right now. Wait for that to finish before disconnecting.`
		);
		return;
	}

	// A connect in flight cannot be called off: the chooser is the host's window.
	if (attempt) {
		releaseWhenIdle = true;
		void vscode.window.showInformationMessage(
			`${PRODUCT}: connecting to a micro:bit right now, and it will be disconnected as soon as that finishes.`
		);
		return;
	}

	await withSerialWritesBlocked(() => board.disconnect());
	void vscode.window.showInformationMessage(`${PRODUCT}: the micro:bit is disconnected.`);
}

/**
 * Whether there is a board to hand back, which decides Connect against
 * Disconnect. Read from the library each time: a copy of ours would drift the
 * first time a cable came out between one menu and the next.
 */
export const boardAttached = (): boolean => connection !== undefined && !IDLE.includes(connection.status);

/** The terminal sees only the serial operations coordinated by this module. */
export const getSerialTransport = (): SerialTransport | undefined =>
	boardAttached() ? serialTransport : undefined;

/** Which micro:bit is on the other end, which decides the image a hex is built from. */
export const boardVersion = (): BoardVersion | undefined => (connection ? versionOf(connection) : undefined);

/** Which physical board is on the other end, so a same-version swap is still visible. */
export const boardSerialNumber = (): string | undefined =>
	(connection ? connection.getDevice()?.serialNumber : undefined) ?? undefined;

/** The board a hex was built for, checked again immediately before it is sent. */
export interface ExpectedBoard {
	version: BoardVersion;
	serialNumber: string | undefined;
}

/**
 * Writes a hex to the board, refusing first if it is no longer `expected`.
 * `source` is only asked for data once the target is halted, so this check, like
 * everything else that can refuse, has to run before `flash()` is called at all.
 */
export function flashBoard(expected: ExpectedBoard, source: FlashDataSource, progress: ProgressCallback): Promise<boolean> {
	const board = connection;
	// One write at a time, enforced here and not only by the command's own guard.
	if (!board || writing) return Promise.resolve(false);

	if (!matchesExpected(board, expected)) {
		warn(BOARD_CHANGED);
		return Promise.resolve(false);
	}

	writing = write(board, source, progress).finally(() => {
		writing = undefined;
	});
	return writing;
}

/** No serial number on either side means unconfirmable, not mismatched, same as `connect.ts`. */
function matchesExpected(board: MicrobitUSBConnection, expected: ExpectedBoard): boolean {
	if (board.status !== ConnectionStatus.Connected) return false;
	if (versionOf(board) !== expected.version) return false;
	if (expected.serialNumber && board.getDevice()?.serialNumber !== expected.serialNumber) return false;
	return true;
}

async function write(
	board: MicrobitUSBConnection,
	source: FlashDataSource,
	progress: ProgressCallback
): Promise<boolean> {
	try {
		await withSerialWritesBlocked(() =>
			board.flash(source, { partial: true, progress, minimumProgressIncrement: PROGRESS_STEP })
		);
		return true;
	} catch (error) {
		log(`The flash failed: ${describeError(error)}`);
		warn(explainDevice(error));
		return false;
	}
}

/**
 * Whether this host can talk to USB at all. The library owns the probe: its
 * whole body is a `navigator.usb` read, which is the property a privacy
 * extension replaces with a throwing getter.
 */
export async function usbAvailable(): Promise<boolean> {
	if (!connection) return false;
	try {
		return (await connection.checkAvailability()) === 'available';
	} catch (error) {
		log(`Could not check whether WebUSB is available: ${String(error)}`);
		return false;
	}
}

/**
 * One connect at a time, whoever asked. Two overlapping attempts build two
 * wrappers over the same device, and the second fails to claim its interface:
 * the user is then told another tab holds a board nothing else is holding.
 */
function connectOnce(board: MicrobitUSBConnection, mayPair: boolean): Promise<Attempted> {
	attempt ??= runConnect(board, mayPair).finally(() => {
		attempt = undefined;
		if (releaseWhenIdle) {
			releaseWhenIdle = false;
			void withSerialWritesBlocked(() => board.disconnect()).then(undefined, (error: unknown) =>
				log(`Could not release: ${describeError(error)}`)
			);
		}
	});
	return attempt;
}

/** `mayPair` belongs to the attempt, so a caller joining one gets its terms. */
async function runConnect(board: MicrobitUSBConnection, mayPair: boolean): Promise<Attempted> {
	// Ours to show and to take away: USB goes straight from no device to connected.
	statusBar?.update(ConnectionStatus.Connecting);
	try {
		return {
			outcome: await connectToBoard({
				authorised: authorisedDevices,
				// A background attempt never opens a chooser nobody asked for.
				canPair: () => mayPair && bridged !== false,
				// Nothing slow in front of this: transient activation is ~5 s in Chromium.
				pair: () => vscode.commands.executeCommand(REQUEST_USB_DEVICE, { filters: [MICROBIT_FILTER] }),
				connect: () => board.connect(),
				attached: () => board.getDevice(),
				log,
			}),
		};
	} catch (error) {
		return { error };
	} finally {
		// A success already moved the bar; everything else has to put it back.
		if (board.status !== ConnectionStatus.Connected) statusBar?.update(board.status, versionOf(board));
	}
}

async function report(board: MicrobitUSBConnection, outcome: Outcome): Promise<boolean> {
	switch (outcome.done) {
		case 'connected':
			return true;
		case 'wrong-board':
			// Awaited: an immediate retry must find it gone, not still `Connected`.
			await withSerialWritesBlocked(() => board.disconnect()).then(undefined, (error: unknown) =>
				log(`Could not release: ${describeError(error)}`)
			);
			warn(WRONG_BOARD);
			return false;
		// The user closed the chooser, so they know, and there is nothing to add.
		case 'declined':
			return false;
		case 'unpairable':
			warn(NO_PAIRING);
			return false;
		case 'refused':
			log(`The device chooser did not open: ${String(outcome.reason)}`);
			warn(CHOOSER_REFUSED);
			return false;
		case 'unauthorised':
			warn(NOT_A_MICROBIT);
			return false;
	}
}

/**
 * One silent retry before saying anything. A reset drops the device and brings
 * it straight back, and a warning for that is noise; a real unplug leaves
 * nothing to reconnect to and is worth exactly one message.
 */
async function recover(board: MicrobitUSBConnection): Promise<void> {
	if (recovering) return;
	recovering = true;
	try {
		await pause(RESETTLE_MS);
		const attempted = await connectOnce(board, false);
		// Anything short of connected is a board that did not come back.
		if ('outcome' in attempted && attempted.outcome.done === 'connected') {
			log('The micro:bit came back and was reconnected without asking');
			return;
		}
		log(`The micro:bit did not come back: ${describeAttempt(attempted)}`);
	} finally {
		recovering = false;
	}

	void vscode.window.showWarningMessage(`${PRODUCT}: the micro:bit was disconnected.`);
}

/** Unasked for, so a failure stays in the output channel. */
async function connectSilently(board: MicrobitUSBConnection): Promise<void> {
	const boards = (await authorisedDevices()).filter(isMicrobit);
	if (boards.length === 0) return;

	log(`${boards.length} micro:bit(s) already authorised, connecting without asking`);
	const attempted = await connectOnce(board, false);
	if (!('outcome' in attempted) || attempted.outcome.done !== 'connected') {
		log(`The silent connect failed: ${describeAttempt(attempted)}`);
	}
}

const describeAttempt = (attempted: Attempted) =>
	'error' in attempted ? describeError(attempted.error) : attempted.outcome.done;

/** Unfiltered, and `navigator.usb` is read inside the guard: a privacy extension can make it throw. */
async function authorisedDevices(): Promise<UsbIdentity[]> {
	try {
		const usb: USB | undefined = navigator.usb;
		return usb ? await usb.getDevices() : [];
	} catch (error) {
		log(`Could not list the authorised USB devices: ${String(error)}`);
		return [];
	}
}

/** Cached by the library until the device is cleared, so it survives a disconnect. */
function versionOf(board: MicrobitUSBConnection): BoardVersion | undefined {
	try {
		return board.getBoardVersion();
	} catch {
		return undefined;
	}
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withSerialWritesBlocked = <T>(operation: () => Promise<T>): Promise<T> =>
	serialTransport ? serialTransport.withWritesBlocked(operation) : operation();

const warn = (message: string | undefined) => {
	if (message) void vscode.window.showErrorMessage(`${PRODUCT}: ${message}`);
};
