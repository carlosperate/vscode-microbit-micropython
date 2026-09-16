import * as vscode from 'vscode';

import { SERIAL_MONITOR_EXTENSION } from '../config';
import { loadSerialMonitor } from './provider';
import { SerialSession, type SerialSessionKey } from './session';
import type { SerialMonitorApi, SerialPortLike } from './types';

const session = new SerialSession();

export function createSerialMonitor(context: vscode.ExtensionContext): void {
	context.subscriptions.push({
		dispose: () => session.dispose(),
	});
}

/** A terminal on a port of ours, through the companion that owns every terminal. */
export async function openEclipseSerial(
	key: SerialSessionKey,
	port: SerialPortLike,
	options: SerialOptions,
	name: string
): Promise<boolean> {
	return session.open(await serialMonitorApi(), key, port, options, name);
}

async function serialMonitorApi(): Promise<SerialMonitorApi> {
	const extension = vscode.extensions.getExtension(SERIAL_MONITOR_EXTENSION);
	return loadSerialMonitor(
		extension
			? {
					version: String(extension.packageJSON?.version ?? ''),
					activate: () => extension.activate(),
				}
			: undefined
	);
}
