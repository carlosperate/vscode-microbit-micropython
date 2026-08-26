import { DeviceError, type DeviceErrorCode } from '@microbit/microbit-connection';

import { PRODUCT } from '../config';

/** Where a micro:bit's interface firmware is updated from. */
const FIRMWARE_UPDATE = 'https://microbit.org/get-started/user-guide/firmware/';

/** The way to program a board that is open on every host and every browser. */
const SAVE_HEX = `Use "${PRODUCT}: Save Hex" instead, then copy the file onto the MICROBIT drive.`;

/** Said on both hosts, so it names no browser. */
export const NO_WEBUSB = `WebUSB is not available here, so a micro:bit cannot be connected. ${SAVE_HEX}`;

/**
 * Nothing on this host can ask for permission to use a board. Desktop VS Code
 * is the case that matters: `requestDevice` is `Window`-only and the extension
 * host is a worker, and the workbench command that bridges the two is
 * registered only in the web workbench.
 */
export const NO_PAIRING = `this window cannot ask for permission to use a micro:bit. ${SAVE_HEX}`;

/**
 * The chooser rejecting without ever opening. Chrome's site settings can block
 * USB for an origin, and the symptom is a command that appears to do nothing at
 * all, so this names the one place a user can go and look.
 */
export const CHOOSER_REFUSED =
	'the device chooser did not open. If this is a browser, check that USB devices are allowed for this site in ' +
	`its settings. ${SAVE_HEX}`;

/** More than one board is allowed, and the library took the wrong one. */
export const WRONG_BOARD =
	'that is a different micro:bit from the one you picked, so it has been disconnected. Unplug the others and ' +
	'connect again.';

/** Pairing succeeded on something this extension cannot then talk to. */
export const NOT_A_MICROBIT =
	'that device is not a micro:bit this extension can use. Pick the one named "BBC micro:bit CMSIS-DAP" or ' +
	'"DAPLink CMSIS-DAP", and see the output for what was authorised.';

/** Nothing is wrong, and nothing needs saying. */
const SILENT = undefined;

/**
 * Every code the library can raise, worded for someone holding a board.
 *
 * Exhaustive over the code union, so a code added upstream fails the build. The
 * Bluetooth-only codes are unreachable over USB and still need an answer, since
 * nothing in the type says which transport a code arrived from.
 */
const MESSAGES: Record<DeviceErrorCode, string | undefined> = {
	aborted: SILENT,
	'no-device-selected': SILENT,
	unsupported: NO_WEBUSB,
	'not-connected': `no micro:bit is connected. Run "${PRODUCT}: Connect" first.`,
	'device-in-use':
		'the micro:bit is already in use, usually by another editor tab, window or program. Close that one and try again.',
	'device-disconnected': 'the micro:bit was disconnected. Plug it back in and try again.',
	timeout: 'the micro:bit stopped responding. Unplug it, plug it back in, and try again.',
	'connection-error':
		'the micro:bit could not be reached. Unplug it, plug it back in, and try again. See the output for the details.',
	'firmware-update-required':
		'this micro:bit answered, but not as a programmable device. Its interface firmware is too old and needs ' +
		`updating: ${FIRMWARE_UPDATE}`,
	disabled: 'the micro:bit could not be reached. See the output for the details.',
	'permission-denied': 'this editor is not allowed to talk to the micro:bit. See the output for the details.',
	'location-disabled': 'the micro:bit could not be reached. See the output for the details.',
	'pairing-information-lost': 'the micro:bit has to be paired again. Unplug it, plug it back in, and connect again.',
};

const UNRECOGNISED = 'the micro:bit could not be reached, see the output for why.';

/**
 * A sentence for a failure, or `undefined` where saying nothing is right: the
 * user cancelled and already knows. Anything that is not a `DeviceError` is a
 * defect rather than a board problem, so it stays behind one generic line with
 * the detail in the output channel.
 */
export function explainDevice(error: unknown): string | undefined {
	if (!(error instanceof DeviceError)) return UNRECOGNISED;
	// A code added upstream between the pinned version and the installed one.
	return error.code in MESSAGES ? MESSAGES[error.code] : UNRECOGNISED;
}

/**
 * The same failure as the output channel should carry it, leading with the code
 * that chose the sentence above. `DeviceError` never sets `name`, so it stringifies
 * as a bare `Error:` and the code, which is the only thing tying a message a user
 * quotes back to the entry that produced it, goes unrecorded.
 */
export const describeError = (error: unknown): string =>
	error instanceof DeviceError ? `${error.code}, ${error.message}` : String(error);
