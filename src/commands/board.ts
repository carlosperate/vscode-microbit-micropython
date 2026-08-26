import * as vscode from 'vscode';

import { PRODUCT } from '../config';
import { connectBoard, disconnectBoard } from '../usb/connection';

/**
 * Pair a micro:bit if none is authorised yet, then connect to it. Every failure
 * has been reported by the time this returns, or was a cancellation that needs
 * no reporting, so a success is the only thing left to say.
 */
export async function connect(): Promise<void> {
	if (await connectBoard()) void vscode.window.showInformationMessage(`${PRODUCT}: the micro:bit is connected.`);
}

/** Hands the board back, so another window or the MICROBIT drive can have it. */
export async function disconnect(): Promise<void> {
	await disconnectBoard();
}
