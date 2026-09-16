import type { SerialMonitorApi, SerialPortLike } from './types';

/** Names one terminal. Only the simulator's today; the key stays so a second kind could sit beside it without either forgetting the other's handle. */
export type SerialSessionKey = string;

/**
 * Owns the opaque handles Eclipse returns without reaching into its terminal
 * map. An open in flight is shared, so two clicks before Eclipse answers still
 * make one terminal.
 */
export class SerialSession {
	private readonly handles = new Map<SerialSessionKey, string>();
	private readonly opening = new Map<SerialSessionKey, Promise<boolean>>();

	public open(
		api: SerialMonitorApi,
		key: SerialSessionKey,
		port?: SerialPortLike,
		options?: SerialOptions,
		name?: string
	): Promise<boolean> {
		const inFlight = this.opening.get(key);
		if (inFlight) return inFlight;

		const opening = this.revealOrOpen(api, key, port, options, name).finally(() => this.opening.delete(key));
		this.opening.set(key, opening);
		return opening;
	}

	private async revealOrOpen(
		api: SerialMonitorApi,
		key: SerialSessionKey,
		port?: SerialPortLike,
		options?: SerialOptions,
		name?: string
	): Promise<boolean> {
		const existing = this.handles.get(key);
		if (existing !== undefined && (await api.revealSerial(existing))) return true;

		this.handles.delete(key);
		const handle = await api.openSerial(port, options, name);
		if (handle) this.handles.set(key, handle);
		return handle !== undefined;
	}

	public dispose(): void {
		this.handles.clear();
	}
}
