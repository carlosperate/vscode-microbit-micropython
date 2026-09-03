import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { log } from '../log';
import { openEclipseSerial, openNativeSerial } from '../serial/eclipse';
import { reportSerialFailure } from '../serial/failure';
import { openSerialRoute } from '../serial/route';
import { SERIAL_BAUD_RATE, TransportSerialPort } from '../serial/transport-port';
import { connectBoard, getSerialTransport, REQUEST_USB_DEVICE, usbAvailable } from '../usb/connection';
import { MICROBIT_FILTER } from '../usb/connect';

const REQUEST_SERIAL_PORT = 'workbench.experimental.requestSerialPort';
const USE_WEB_SERIAL = 'Use Web Serial';

export async function openTerminal(): Promise<void> {
	try {
		const commands = await vscode.commands.getCommands(true);
		await openSerialRoute({
			browserDeviceBridges:
				commands.includes(REQUEST_USB_DEVICE) || commands.includes(REQUEST_SERIAL_PORT),
			hasWebUsb: usbAvailable,
			hasWebSerial: () => webSerialAvailable(commands),
			openNative: () => openNativeSerial(commands),
			openWebUsb,
			openWebSerial,
			offerWebSerial: async () =>
				(await vscode.window.showInformationMessage(
					`${PRODUCT}: open the terminal through Web Serial instead?`,
					USE_WEB_SERIAL
				)) === USE_WEB_SERIAL,
			unsupported: () => {
				void vscode.window.showErrorMessage(
					`${PRODUCT}: the serial terminal needs WebUSB or Web Serial in this browser.`
				);
			},
		});
	} catch (error) {
		await reportSerialFailure(error);
	}
}

async function openWebUsb(): Promise<boolean> {
	if (!(await connectBoard())) return false;
	const transport = getSerialTransport();
	if (!transport) {
		// The board left between connecting and here, and the UI says so; this is the
		// only trace of why no terminal opened.
		log('The micro:bit was gone before a terminal could be opened');
		return false;
	}

	return openEclipseSerial(
		'webusb',
		new TransportSerialPort(transport, {
			info: { usbVendorId: MICROBIT_FILTER.vendorId, usbProductId: MICROBIT_FILTER.productId },
			disconnected: 'The micro:bit was disconnected.',
		}),
		{ baudRate: SERIAL_BAUD_RATE },
		PRODUCT
	);
}

async function openWebSerial(): Promise<boolean> {
	return openEclipseSerial('webserial', MICROBIT_FILTER, { baudRate: SERIAL_BAUD_RATE }, PRODUCT);
}

async function webSerialAvailable(commands: readonly string[]): Promise<boolean> {
	let serial: Serial | undefined;
	try {
		serial = navigator.serial;
	} catch (error) {
		log(`Could not check whether Web Serial is available: ${String(error)}`);
		return false;
	}
	if (!serial) return false;

	try {
		const ports = await serial.getPorts();
		if (
			ports.some((port) => {
				const info = port.getInfo();
				return info.usbVendorId === MICROBIT_FILTER.vendorId && info.usbProductId === MICROBIT_FILTER.productId;
			})
		) {
			return true;
		}
	} catch (error) {
		log(`Could not list authorised Web Serial ports: ${String(error)}`);
	}

	return commands.includes(REQUEST_SERIAL_PORT);
}
