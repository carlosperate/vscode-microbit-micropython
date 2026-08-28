import { describe, expect, it, vi } from 'vitest';

import { loadSerialMonitor, SerialMonitorError, type SerialMonitorProvider } from '../src/serial/provider';
import type { SerialMonitorApi } from '../src/serial/types';

function api(): SerialMonitorApi {
	return {
		openSerial: vi.fn(async () => 'handle'),
		revealSerial: vi.fn(async () => true),
	};
}

function provider(exported: unknown, version = '2.0.0'): SerialMonitorProvider {
	return { version, activate: async () => exported };
}

describe('the Eclipse extension boundary', () => {
	it('requires the companion to be installed', async () => {
		await expect(loadSerialMonitor()).rejects.toBeInstanceOf(SerialMonitorError);
	});

	it('rejects an older API release with the installed version in the message', async () => {
		await expect(loadSerialMonitor(provider({}, '1.4.0'))).rejects.toThrow(/2\.0\.0.*1\.4\.0/);
	});

	it('names an activation failure', async () => {
		const broken: SerialMonitorProvider = {
			version: '2.0.0',
			activate: async () => {
				throw new Error('broken bundle');
			},
		};
		await expect(loadSerialMonitor(broken)).rejects.toThrow(/could not be activated.*broken bundle/);
	});

	it('rejects missing and incomplete API v2 exports', async () => {
		await expect(loadSerialMonitor(provider(undefined))).rejects.toThrow(/did not provide/);
		await expect(loadSerialMonitor(provider({ getApi: () => ({}) }))).rejects.toThrow(/missing openSerial/);
	});

	it('returns the API subset this extension uses', async () => {
		const monitor = api();
		await expect(loadSerialMonitor(provider({ getApi: () => monitor }))).resolves.toBe(monitor);
	});
});
