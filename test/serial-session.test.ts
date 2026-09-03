import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SerialSession } from '../src/serial/session';
import type { SerialMonitorApi } from '../src/serial/types';

function api(): SerialMonitorApi {
	return {
		openSerial: vi.fn(async () => 'handle-1'),
		revealSerial: vi.fn(async () => true),
	};
}

let session: SerialSession;

beforeEach(() => {
	session = new SerialSession();
});

describe('Eclipse terminal handles', () => {
	it('reveals an existing terminal instead of opening a duplicate', async () => {
		const monitor = api();
		await session.open(monitor, 'webusb');
		await session.open(monitor, 'webusb');

		expect(monitor.openSerial).toHaveBeenCalledOnce();
		expect(monitor.revealSerial).toHaveBeenCalledWith('handle-1');
	});

	it('reopens after Eclipse says the old handle is stale', async () => {
		const monitor = api();
		vi.mocked(monitor.revealSerial).mockResolvedValue(false);
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('old').mockResolvedValueOnce('new');

		await session.open(monitor, 'webusb');
		await expect(session.open(monitor, 'webusb')).resolves.toBe(true);
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	it('does not reveal a handle opened for a different transport', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('webusb-handle').mockResolvedValueOnce('webserial-handle');

		await session.open(monitor, 'webusb');
		await expect(session.open(monitor, 'webserial')).resolves.toBe(true);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	/** A board and the simulator are two devices, so each gets its own terminal. */
	it('opens a second terminal for the simulator beside the board’s', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('board').mockResolvedValueOnce('simulator');

		await session.open(monitor, 'webusb');
		await expect(session.open(monitor, 'simulator')).resolves.toBe(true);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);

		await session.open(monitor, 'simulator');
		expect(monitor.revealSerial).toHaveBeenCalledExactlyOnceWith('simulator');
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	/**
	 * The case a single slot gets wrong: opening the simulator's terminal made it
	 * forget the board's, so asking for the board again opened a third terminal and
	 * orphaned the first.
	 */
	it('reveals the board’s terminal again after the simulator’s was opened', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('board').mockResolvedValueOnce('simulator');

		await session.open(monitor, 'webusb');
		await session.open(monitor, 'simulator');
		await expect(session.open(monitor, 'webusb')).resolves.toBe(true);

		expect(monitor.revealSerial).toHaveBeenCalledExactlyOnceWith('board');
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	/**
	 * A double click on a button reaches here twice before Eclipse has answered
	 * once, and both callers would otherwise see no handle and open a terminal each.
	 */
	it('shares an open in flight, so two requests before Eclipse answers make one terminal', async () => {
		const monitor = api();
		let answer: (handle: string) => void = () => undefined;
		vi.mocked(monitor.openSerial).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

		const first = session.open(monitor, 'simulator');
		const second = session.open(monitor, 'simulator');
		answer('simulator');
		await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
		expect(monitor.openSerial).toHaveBeenCalledOnce();

		await session.open(monitor, 'simulator');
		expect(monitor.revealSerial).toHaveBeenCalledExactlyOnceWith('simulator');
		expect(monitor.openSerial).toHaveBeenCalledOnce();
	});

	it('does not make the board wait for the simulator, or the other way round', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('board').mockResolvedValueOnce('simulator');

		await expect(Promise.all([session.open(monitor, 'webusb'), session.open(monitor, 'simulator')])).resolves.toEqual([
			true,
			true,
		]);
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	it('lets a failed open be tried again rather than sharing the failure for good', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce('later');

		await expect(session.open(monitor, 'simulator')).rejects.toThrow('busy');
		await expect(session.open(monitor, 'simulator')).resolves.toBe(true);
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	it('forgets the handle on disposal without closing Eclipse internals', async () => {
		const monitor = api();
		await session.open(monitor, 'webusb');
		session.dispose();
		await session.open(monitor, 'webusb');

		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
	});
});
