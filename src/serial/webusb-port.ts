import { MICROBIT_FILTER } from '../usb/connect';
import type { SerialPortLike, SerialTransport } from './types';

export const SERIAL_BAUD_RATE = 115200;

interface PortState {
	decoder: TextDecoder;
	readableController?: ReadableStreamDefaultController<Uint8Array>;
	writableController?: WritableStreamDefaultController;
	writableEnded: boolean;
	stopData?: () => void;
	stopDisconnect?: () => void;
}

/** Adapts the connection's string events to the byte streams Eclipse consumes. */
export class WebUsbSerialPort implements SerialPortLike {
	public readable: ReadableStream<Uint8Array> | null = null;
	public writable: WritableStream<Uint8Array> | null = null;

	private state: PortState | undefined;
	private finishing: Promise<void> | undefined;

	public constructor(private readonly transport: SerialTransport) {}

	public getInfo(): SerialPortInfo {
		return { usbVendorId: MICROBIT_FILTER.vendorId, usbProductId: MICROBIT_FILTER.productId };
	}

	public async open(options: SerialOptions): Promise<void> {
		if (this.state || this.finishing) throw new Error('The WebUSB serial port is already open.');
		if (options.baudRate !== SERIAL_BAUD_RATE) {
			throw new Error(`WebUSB serial currently supports ${SERIAL_BAUD_RATE} baud only.`);
		}

		const state: PortState = { decoder: new TextDecoder(), writableEnded: false };
		const encoder = new TextEncoder();
		this.state = state;
		this.readable = new ReadableStream<Uint8Array>({
			start: (controller) => {
				state.readableController = controller;
				state.stopData = this.transport.onData((data) => controller.enqueue(encoder.encode(data)));
				state.stopDisconnect = this.transport.onDisconnect(() =>
					this.finish(new Error('The micro:bit was disconnected.'))
				);
			},
			cancel: () => this.finish(undefined, false),
		});
		this.writable = new WritableStream<Uint8Array>({
			start: (controller) => {
				state.writableController = controller;
			},
			write: async (data) => {
				if (this.state !== state) throw new Error('The WebUSB serial port is closed.');
				const text = state.decoder.decode(data, { stream: true });
				if (text) await this.transport.write(text);
			},
			close: async () => {
				await this.flush(state.decoder);
				state.writableEnded = true;
			},
			abort: () => {
				state.writableEnded = true;
			},
		});
	}

	public async close(): Promise<void> {
		await this.finish();
	}

	private finish(error?: Error, signalReadable = true): Promise<void> {
		if (this.finishing) return this.finishing;
		const state = this.state;
		if (!state) return Promise.resolve();
		this.state = undefined;
		state.stopData?.();
		state.stopDisconnect?.();

		const writable = this.writable;
		this.readable = null;
		this.writable = null;

		if (signalReadable && state.readableController) {
			if (error) state.readableController.error(error);
			else state.readableController.close();
		}
		if (error) {
			state.writableEnded = true;
			state.writableController?.error(error);
		}

		const finishing = error
			? Promise.resolve()
			: state.writableEnded
				? Promise.resolve()
				: writable && !writable.locked
					? writable.close()
					: this.flush(state.decoder).finally(() => {
							state.writableEnded = true;
							state.writableController?.error(new Error('The WebUSB serial port is closed.'));
						});
		const tracked = finishing.finally(() => {
			if (this.finishing === tracked) this.finishing = undefined;
		});
		this.finishing = tracked;
		return tracked;
	}

	private async flush(decoder: TextDecoder): Promise<void> {
		const trailing = decoder.decode();
		if (trailing) await this.transport.write(trailing);
	}
}
