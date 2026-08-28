/** The subset of Eclipse's public API and Web Serial shape used here. */

export interface SerialFilter {
	serialNumber?: string;
	vendorId?: number;
	productId?: number;
	path?: string;
}

export interface SerialTransport {
	onData(listener: (data: string) => void): () => void;
	onDisconnect(listener: () => void): () => void;
	write(data: string): Promise<void>;
}

export type SerialPortLike = Pick<SerialPort, 'readable' | 'writable' | 'getInfo' | 'open' | 'close'>;

export interface SerialMonitorApi {
	openSerial(
		portOrFilter?: SerialPortLike | SerialFilter,
		options?: SerialOptions,
		name?: string
	): Promise<string | undefined>;
	revealSerial(handle: string): Promise<boolean>;
}

export interface SerialMonitorExtension {
	getApi(version: 2): SerialMonitorApi;
}
