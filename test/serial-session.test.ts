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

	it('forgets the handle on disposal without closing Eclipse internals', async () => {
		const monitor = api();
		await session.open(monitor, 'webusb');
		session.dispose();
		await session.open(monitor, 'webusb');

		expect(monitor.openSerial).toHaveBeenCalledTimes(2);
		expect(monitor.revealSerial).not.toHaveBeenCalled();
	});
});
