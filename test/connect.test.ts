import { describe, expect, it, vi } from 'vitest';

import { connectToBoard, isMicrobit, MICROBIT_FILTER, type Attempt, type UsbIdentity } from '../src/usb/connect';

const BOARD: UsbIdentity = { vendorId: 0x0d28, productId: 0x0204, serialNumber: '9900' };

/** Same vendor, different product: the case a `vendorId`-only filter lets through. */
const OTHER: UsbIdentity = { vendorId: 0x0d28, productId: 0x0f00, serialNumber: 'other' };

/** Spied over the overrides, never beside them, or an override silences its spy. */
function attempt(overrides: Partial<Attempt> = {}) {
	const spies = {
		authorised: vi.fn<Attempt['authorised']>(overrides.authorised ?? (async () => [])),
		canPair: vi.fn<Attempt['canPair']>(overrides.canPair ?? (() => true)),
		pair: vi.fn<Attempt['pair']>(overrides.pair ?? (async () => undefined)),
		connect: vi.fn<Attempt['connect']>(overrides.connect ?? (async () => undefined)),
		// Defaults to the board that was picked, which is the case that is not a bug.
		attached: vi.fn<Attempt['attached']>(overrides.attached ?? (() => BOARD)),
		log: vi.fn<Attempt['log']>(overrides.log ?? (() => undefined)),
	};
	return { spies, deps: spies satisfies Attempt };
}

const dismissal = () => Object.assign(new Error('No device selected.'), { name: 'NotFoundError' });

/** Empty first, so pairing runs, then whatever the second look should find. */
const pairingThenVisible = (visible: UsbIdentity[]) =>
	vi.fn<() => Promise<UsbIdentity[]>>().mockResolvedValueOnce([]).mockResolvedValueOnce(visible);

describe('the device filter', () => {
	it('is the one the library applies to getDevices()', () => {
		expect(MICROBIT_FILTER).toEqual({ vendorId: 0x0d28, productId: 0x0204 });
	});

	/**
	 * The library re-filters `getDevices()` on both fields. Counting a device it
	 * would reject as authorised is what sends it down its own unreachable
	 * `chooseDevice()` path.
	 */
	it('rejects the right vendor with the wrong product', () => {
		expect(isMicrobit(BOARD)).toBe(true);
		expect(isMicrobit(OTHER)).toBe(false);
		expect(isMicrobit({ vendorId: 0x1234, productId: 0x0204 })).toBe(false);
	});
});

describe('reaching a board', () => {
	it('connects straight to one that is already authorised, without pairing', async () => {
		const { spies, deps } = attempt({ authorised: async () => [BOARD] });

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'connected' });
		expect(spies.connect).toHaveBeenCalledOnce();
		expect(spies.pair).not.toHaveBeenCalled();
	});

	it('pairs first when nothing is authorised, and connects after', async () => {
		const authorised = vi.fn<() => Promise<UsbIdentity[]>>().mockResolvedValueOnce([]).mockResolvedValueOnce([BOARD]);
		const { spies, deps } = attempt({ authorised, pair: async () => BOARD });

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'connected' });
		expect(spies.connect).toHaveBeenCalledOnce();
	});

	/**
	 * The library is never told which device was authorised, so it takes the first
	 * micro:bit in its own list. With a second board already allowed, that can be
	 * the wrong one, and a flash would reach it reporting success.
	 */
	it('refuses a connection that landed on a board the user did not pick', async () => {
		const older = { vendorId: 0x0d28, productId: 0x0204, serialNumber: 'an-older-board' };
		const { deps } = attempt({
			authorised: pairingThenVisible([older, BOARD]),
			pair: async () => BOARD,
			attached: () => older,
		});

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'wrong-board' });
	});

	/** Nothing to compare against is not the same as a mismatch. */
	it('accepts a connection it cannot confirm either way', async () => {
		const nameless = { vendorId: 0x0d28, productId: 0x0204 };
		const { deps } = attempt({
			authorised: pairingThenVisible([nameless]),
			pair: async () => nameless,
			attached: () => nameless,
		});

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'connected' });
	});

	/**
	 * The one outcome that must never happen: connecting with nothing authorised
	 * walks the library into a `requestDevice` that does not exist in a worker.
	 */
	it('never connects while there is nothing for the library to find', async () => {
		const answers: Attempt['pair'][] = [
			async () => undefined,
			() => Promise.reject(dismissal()),
			async () => OTHER,
		];

		for (const pair of answers) {
			const { spies, deps } = attempt({ pair });
			await connectToBoard(deps);
			expect(spies.connect).not.toHaveBeenCalled();
		}
	});

	it('does not connect to a device that pairing produced but this side cannot see', async () => {
		const { spies, deps } = attempt({ authorised: async () => [], pair: async () => OTHER });

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'unauthorised' });
		expect(spies.connect).not.toHaveBeenCalled();
	});

	it('lets a connection failure through, because only the caller can word it', async () => {
		const { deps } = attempt({
			authorised: async () => [BOARD],
			connect: async () => {
				throw new Error('device-in-use');
			},
		});

		await expect(connectToBoard(deps)).rejects.toThrow('device-in-use');
	});
});

/**
 * The bridge answers two different ways when it does not hand back a device,
 * and treating either as a pairing is how a status bar gets stuck on
 * "Connecting" forever.
 */
describe('the two ways pairing can not produce a device', () => {
	it('reads a resolved undefined as a host with no WebUSB', async () => {
		const { deps } = attempt({ pair: async () => undefined });
		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'unpairable' });
	});

	/**
	 * Desktop VS Code carries the class that registers the bridge command and
	 * never instantiates it, so there is nothing to call there and nothing to
	 * gain from trying.
	 */
	it('does not reach for a bridge the host does not have', async () => {
		const { spies, deps } = attempt({ canPair: () => false });

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'unpairable' });
		expect(spies.pair).not.toHaveBeenCalled();
	});

	it('reads a dismissed chooser as the user declining, which needs no message', async () => {
		const { deps } = attempt({ pair: () => Promise.reject(dismissal()) });
		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'declined' });
	});

	/**
	 * A chooser that never opened at all, which is what a site-level USB block
	 * looks like. Silence there reads as a command that does nothing.
	 */
	it('tells a chooser that never opened apart from one that was closed', async () => {
		const blocked = new Error('Access to the feature "usb" is disallowed by permissions policy.');
		const { deps } = attempt({ pair: () => Promise.reject(blocked) });

		await expect(connectToBoard(deps)).resolves.toEqual({ done: 'refused', reason: blocked });
	});
});
