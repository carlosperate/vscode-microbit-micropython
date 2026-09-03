import type { SerialFilter, SerialMonitorApi, SerialPortLike } from './types';

export type SerialSessionKey = 'webusb' | 'webserial' | 'simulator';

/**
 * Owns the opaque handles Eclipse returns without reaching into its terminal
 * map. One per key, not one in all: a board and the simulator are open at once,
 * and a single slot would forget the board's terminal and open a third. An open
 * in flight is shared, so two clicks before Eclipse answers still make one terminal.
 */
export class SerialSession {
	private readonly handles = new Map<SerialSessionKey, string>();
	private readonly opening = new Map<SerialSessionKey, Promise<boolean>>();

	public open(
		api: SerialMonitorApi,
		key: SerialSessionKey,
		portOrFilter?: SerialPortLike | SerialFilter,
		options?: SerialOptions,
		name?: string
	): Promise<boolean> {
		const inFlight = this.opening.get(key);
		if (inFlight) return inFlight;

		const opening = this.revealOrOpen(api, key, portOrFilter, options, name).finally(() => this.opening.delete(key));
		this.opening.set(key, opening);
		return opening;
	}

	private async revealOrOpen(
		api: SerialMonitorApi,
		key: SerialSessionKey,
		portOrFilter?: SerialPortLike | SerialFilter,
		options?: SerialOptions,
		name?: string
	): Promise<boolean> {
		const existing = this.handles.get(key);
		if (existing !== undefined && (await api.revealSerial(existing))) return true;

		this.handles.delete(key);
		const handle = await api.openSerial(portOrFilter, options, name);
		if (handle) this.handles.set(key, handle);
		return handle !== undefined;
	}

	public dispose(): void {
		this.handles.clear();
	}
}
