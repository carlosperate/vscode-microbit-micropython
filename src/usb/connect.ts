/**
 * Deciding how to reach a micro:bit, without touching WebUSB or VS Code.
 *
 * `@microbit/microbit-connection` falls through to its own `requestDevice()`
 * when it cannot find an authorised device, and that call is `Window`-only: in
 * an extension host worker it throws `requestDevice is not a function` from
 * inside the library. So whether to connect or to pair is decided here, before
 * the library is asked to do either.
 */

/**
 * The library's own `defaultFilters`. It re-applies both fields to
 * `getDevices()`, so authorising on `vendorId` alone leaves a device the editor
 * considers paired and the library considers absent.
 */
export const MICROBIT_FILTER = { vendorId: 0x0d28, productId: 0x0204 };

/** As much of a USB device as any of this needs, from either side of the bridge. */
export interface UsbIdentity {
	vendorId: number;
	productId: number;
	serialNumber?: string | null;
}

/** What happened, for the adapter to word. Only `connected` reached a board. */
export type Outcome =
	| { done: 'connected' }
	/**
	 * Connected, but to a different board than the one just authorised. The
	 * connection is live and has to be given back by the caller: leaving it is
	 * how a flash reaches a board the user did not choose.
	 */
	| { done: 'wrong-board' }
	/** Nothing on this host can ask for permission to use a board. */
	| { done: 'unpairable' }
	/** The chooser opened and the user closed it. */
	| { done: 'declined' }
	/** The chooser never opened, which a site-level USB block looks like. */
	| { done: 'refused'; reason: unknown }
	/** Something was authorised that this extension cannot then see. */
	| { done: 'unauthorised' };

export interface Attempt {
	/** Everything `navigator.usb.getDevices()` returns, unfiltered. */
	authorised: () => PromiseLike<UsbIdentity[]>;
	/**
	 * Whether this host offers the bridge at all. Desktop VS Code does not, so
	 * there it is only ever a board somebody else authorised.
	 */
	canPair: () => boolean;
	/**
	 * The bridged `requestDevice`: the device as plain data, `undefined` where
	 * the main thread has no WebUSB, and a rejection when the chooser closes
	 * with nothing picked.
	 */
	pair: () => PromiseLike<unknown>;
	connect: () => PromiseLike<void>;
	/** The device the library actually attached to, once `connect` has returned. */
	attached: () => UsbIdentity | undefined;
	log: (message: string) => void;
}

/**
 * Connect to an authorised board, or pair one first. `connect` is only ever
 * called with a device the library's own filter accepts, which is what keeps
 * its unreachable `requestDevice()` path out of reach.
 *
 * Failures from `connect` are thrown, not returned: they carry a `DeviceError`
 * code the caller turns into a sentence.
 */
export async function connectToBoard(attempt: Attempt): Promise<Outcome> {
	if ((await microbits(attempt)).length > 0) {
		await attempt.connect();
		return { done: 'connected' };
	}

	if (!attempt.canPair()) {
		attempt.log('This host has no way to ask for permission to use a micro:bit');
		return { done: 'unpairable' };
	}

	let paired: unknown;
	try {
		paired = await attempt.pair();
	} catch (reason) {
		if (!dismissed(reason)) return { done: 'refused', reason };
		attempt.log('The device chooser was closed without picking anything');
		return { done: 'declined' };
	}

	if (!isIdentity(paired)) {
		attempt.log(`Pairing answered ${JSON.stringify(paired) ?? 'undefined'} rather than a device`);
		return { done: 'unpairable' };
	}

	// The bridge forwards our filter, so this should not happen; it is checked
	// because the same wrong device would otherwise be caught only by the weaker
	// test below, and only when nothing else is plugged in.
	if (!isMicrobit(paired)) {
		attempt.log(`Authorised ${describe(paired)}, which is not a micro:bit this extension can use`);
		return { done: 'unauthorised' };
	}

	// The bridge hands back plain data, never a `USBDevice`, so the serial number
	// is the only link between what was authorised and what this side can see.
	const visible = await microbits(attempt);
	if (!visible.some((device) => sameDevice(device, paired))) {
		attempt.log(`Authorised ${describe(paired)}, which is not among the ${visible.length} device(s) this side can see`);
		return { done: 'unauthorised' };
	}

	await attempt.connect();
	return confirm(attempt, paired);
}

/**
 * Which board the library actually took.
 *
 * It is never told which device was authorised, so it walks its own filtered
 * `getDevices()` and attaches to the first micro:bit that answers. With a second
 * board already allowed and plugged in that can be a different one, and a flash
 * would reach it reporting success.
 */
function confirm(attempt: Attempt, paired: UsbIdentity): Outcome {
	const attached = attempt.attached();
	if (!paired.serialNumber || !attached?.serialNumber) {
		attempt.log('Could not confirm which micro:bit this is: one of the two has no serial number');
		return { done: 'connected' };
	}
	if (attached.serialNumber === paired.serialNumber) return { done: 'connected' };

	attempt.log(`Attached to ${attached.serialNumber}, which is not the ${paired.serialNumber} that was authorised`);
	return { done: 'wrong-board' };
}

async function microbits(attempt: Attempt): Promise<UsbIdentity[]> {
	return (await attempt.authorised()).filter(isMicrobit);
}

export const isMicrobit = (device: UsbIdentity): boolean =>
	device.vendorId === MICROBIT_FILTER.vendorId && device.productId === MICROBIT_FILTER.productId;

/** A board with no serial number cannot be told from another, so presence is all there is. */
const sameDevice = (device: UsbIdentity, paired: UsbIdentity): boolean =>
	paired.serialNumber == null || device.serialNumber === paired.serialNumber;

/**
 * Chromium's chooser rejects with a `NotFoundError` reading "No device
 * selected." when it is closed, and with something else entirely when it never
 * opened. The message is the only thing that tells them apart, which is why the
 * library matches on it too.
 */
const dismissed = (reason: unknown) => reason instanceof Error && /No device selected/i.test(reason.message);

/**
 * Every field this makes a decision on, checked. The bridge is an experimental
 * workbench command, and a shape that only half arrives would otherwise reach
 * `describe` and throw where a refusal was meant to be returned.
 */
function isIdentity(value: unknown): value is UsbIdentity {
	if (typeof value !== 'object' || value === null) return false;
	const { vendorId, productId, serialNumber } = value as UsbIdentity;
	return (
		typeof vendorId === 'number' &&
		typeof productId === 'number' &&
		(serialNumber == null || typeof serialNumber === 'string')
	);
}

const describe = (device: UsbIdentity) =>
	`${hex(device.vendorId)}:${hex(device.productId)} serial ${device.serialNumber ?? 'unknown'}`;

const hex = (value: number) => `0x${value.toString(16).padStart(4, '0')}`;
