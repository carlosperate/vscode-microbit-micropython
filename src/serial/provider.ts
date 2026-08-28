import type { SerialMonitorApi, SerialMonitorExtension } from './types';

export class SerialMonitorError extends Error {}

export interface SerialMonitorProvider {
	version: string;
	activate(): PromiseLike<unknown>;
}

/** Validates the separately installed extension before any terminal is opened. */
export async function loadSerialMonitor(provider?: SerialMonitorProvider): Promise<SerialMonitorApi> {
	if (!provider) {
		throw new SerialMonitorError('Install or enable the Eclipse Serial Monitor extension.');
	}

	const major = Number.parseInt(provider.version.split('.')[0] ?? '', 10);
	if (!Number.isInteger(major) || major < 2) {
		throw new SerialMonitorError(
			`Eclipse Serial Monitor 2.0.0 or later is required; found ${provider.version || 'unknown'}.`
		);
	}

	let implementation: unknown;
	try {
		implementation = await provider.activate();
	} catch (error) {
		throw new SerialMonitorError(`Eclipse Serial Monitor could not be activated: ${String(error)}`);
	}

	const extension = implementation as Partial<SerialMonitorExtension> | undefined;
	if (!extension || typeof extension.getApi !== 'function') {
		throw new SerialMonitorError('Eclipse Serial Monitor did not provide its extension API.');
	}

	let api: SerialMonitorApi;
	try {
		api = extension.getApi(2);
	} catch (error) {
		throw new SerialMonitorError(`Eclipse Serial Monitor API v2 is unavailable: ${String(error)}`);
	}

	const required: (keyof SerialMonitorApi)[] = ['openSerial', 'revealSerial'];
	const missing = required.filter((method) => typeof api?.[method] !== 'function');
	if (missing.length) {
		throw new SerialMonitorError(`Eclipse Serial Monitor API v2 is missing ${missing.join(', ')}.`);
	}
	return api;
}
