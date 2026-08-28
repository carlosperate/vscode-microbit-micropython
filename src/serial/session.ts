import type { SerialFilter, SerialMonitorApi, SerialPortLike } from './types';

export type SerialSessionKey = 'webusb' | 'webserial';

/** Owns the opaque handle Eclipse returns without reaching into its terminal map. */
export class SerialSession {
	private current: { handle: string; key: SerialSessionKey } | undefined;

	public async open(
		api: SerialMonitorApi,
		key: SerialSessionKey,
		portOrFilter?: SerialPortLike | SerialFilter,
		options?: SerialOptions,
		name?: string
	): Promise<boolean> {
		if (this.current?.key === key && (await api.revealSerial(this.current.handle))) return true;

		this.current = undefined;
		const handle = await api.openSerial(portOrFilter, options, name);
		if (handle) this.current = { handle, key };
		return handle !== undefined;
	}

	public dispose(): void {
		this.current = undefined;
	}
}
