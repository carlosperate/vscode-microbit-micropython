export type SerialRoute = 'native' | 'webusb' | 'webserial' | 'cancelled' | 'unsupported';

/** Injected actions keep transport priority testable without a browser or editor. */
export interface SerialRouteActions {
	browserDeviceBridges: boolean;
	hasWebUsb(): Promise<boolean>;
	hasWebSerial(): Promise<boolean>;
	openNative(): Promise<boolean>;
	openWebUsb(): Promise<boolean>;
	openWebSerial(): Promise<boolean>;
	offerWebSerial(): Promise<boolean>;
	unsupported(): void;
}

export async function openSerialRoute(actions: SerialRouteActions): Promise<SerialRoute> {
	if (!actions.browserDeviceBridges) {
		return (await actions.openNative()) ? 'native' : 'cancelled';
	}

	if (await actions.hasWebUsb()) {
		if (await actions.openWebUsb()) return 'webusb';
		if (!(await actions.hasWebSerial()) || !(await actions.offerWebSerial())) return 'cancelled';
		return (await actions.openWebSerial()) ? 'webserial' : 'cancelled';
	}

	if (await actions.hasWebSerial()) {
		return (await actions.openWebSerial()) ? 'webserial' : 'cancelled';
	}

	actions.unsupported();
	return 'unsupported';
}
