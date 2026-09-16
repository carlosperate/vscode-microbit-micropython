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
		await session.open(monitor, 'simulator');
		await session.open(monitor, 'simulator');

		expect(monitor.openSerial).toHaveBeenCalledOnce();
		expect(monitor.revealSerial).toHaveBeenCalledWith('handle-1');
	});

	it('reopens after Eclipse says the old handle is stale', async () => {
		const monitor = api();
		vi.mocked(monitor.revealSerial).mockResolvedValue(false);
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('old').mockResolvedValueOnce('new');

		await session.open(monitor, 'simulator');
		await expect(session.open(monitor, 'simulator')).resolves.toBe(true);
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	it('does not reveal a handle opened for a different transport', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('simulator-handle').mockResolvedValueOnce('other-handle');

		await session.open(monitor, 'simulator');
		await expect(session.open(monitor, 'other')).resolves.toBe(true);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	/** Two keys are two terminals: a second kind would sit beside the simulator's without either forgetting its handle. */
	it('opens a second terminal under another key beside the simulator’s', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('simulator-handle').mockResolvedValueOnce('other-handle');

		await session.open(monitor, 'simulator');
		await expect(session.open(monitor, 'other')).resolves.toBe(true);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);

		await session.open(monitor, 'simulator');
		expect(monitor.revealSerial).toHaveBeenCalledExactlyOnceWith('simulator-handle');
		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
	});

	/**
	 * The case a single slot gets wrong: opening a second terminal made it forget
	 * the first, so asking for the first again opened a third and orphaned it.
	 */
	it('reveals the first terminal again after a second was opened', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('simulator-handle').mockResolvedValueOnce('other-handle');

		await session.open(monitor, 'simulator');
		await session.open(monitor, 'other');
		await expect(session.open(monitor, 'simulator')).resolves.toBe(true);

		expect(monitor.revealSerial).toHaveBeenCalledExactlyOnceWith('simulator-handle');
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

	it('does not make one key wait for another', async () => {
		const monitor = api();
		vi.mocked(monitor.openSerial).mockResolvedValueOnce('simulator-handle').mockResolvedValueOnce('other-handle');

		await expect(Promise.all([session.open(monitor, 'simulator'), session.open(monitor, 'other')])).resolves.toEqual([
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
		await session.open(monitor, 'simulator');
		session.dispose();
		await session.open(monitor, 'simulator');

		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
	});
});
