import { beforeEach, describe, expect, it } from 'vitest';

import { SERIAL_BAUD_RATE, WebUsbSerialPort } from '../src/serial/webusb-port';
import type { SerialTransport } from '../src/serial/types';

class FakeTransport implements SerialTransport {
	public readonly dataListeners = new Set<(data: string) => void>();
	public readonly disconnectListeners = new Set<() => void>();
	public readonly writes: string[] = [];

	public onData(listener: (data: string) => void): () => void {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}

	public onDisconnect(listener: () => void): () => void {
		this.disconnectListeners.add(listener);
		return () => this.disconnectListeners.delete(listener);
	}

	public async write(data: string): Promise<void> {
		this.writes.push(data);
	}

	public emitData(data: string): void {
		for (const listener of this.dataListeners) listener(data);
	}

	public disconnect(): void {
		for (const listener of this.disconnectListeners) listener();
	}
}

let transport: FakeTransport;
let port: WebUsbSerialPort;

beforeEach(() => {
	transport = new FakeTransport();
	port = new WebUsbSerialPort(transport);
});

describe('the WebUSB Web Serial adapter', () => {
	it('attaches one listener and exposes incoming strings as bytes', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		expect(transport.dataListeners.size).toBe(1);
		expect(transport.disconnectListeners.size).toBe(1);

		const reader = port.readable?.getReader();
		expect(reader).toBeDefined();
		const reading = reader!.read();
		transport.emitData('hello');
		const result = await reading;
		expect(new TextDecoder().decode(result.value)).toBe('hello');
		reader!.releaseLock();
	});

	it('streams split UTF-8 writes without corrupting them', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const writer = port.writable!.getWriter();
		const bytes = new TextEncoder().encode('café');
		await writer.write(bytes.slice(0, 4));
		await writer.write(bytes.slice(4));
		writer.releaseLock();

		expect(transport.writes.join('')).toBe('café');
	});

	it('passes Ctrl-C and Ctrl-D through unchanged', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const writer = port.writable!.getWriter();
		await writer.write(new Uint8Array([3, 4]));
		writer.releaseLock();

		expect(transport.writes).toEqual(['\x03\x04']);
	});

	it('detaches every listener on close and creates fresh streams on reopen', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const firstReadable = port.readable;
		const firstWritable = port.writable!;
		await port.close();

		expect(transport.dataListeners.size).toBe(0);
		expect(transport.disconnectListeners.size).toBe(0);
		expect(port.readable).toBeNull();
		expect(port.writable).toBeNull();
		const closedWriter = firstWritable.getWriter();
		await expect(closedWriter.closed).resolves.toBeUndefined();
		await expect(closedWriter.write(new TextEncoder().encode('late'))).rejects.toThrow();
		closedWriter.releaseLock();

		await port.open({ baudRate: SERIAL_BAUD_RATE });
		expect(port.readable).not.toBe(firstReadable);
		expect(transport.dataListeners.size).toBe(1);
	});

	it('ends the stream with a useful error when the board disconnects', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const reader = port.readable!.getReader();
		const writer = port.writable!.getWriter();
		const reading = reader.read();
		transport.disconnect();

		await expect(reading).rejects.toThrow('The micro:bit was disconnected.');
		await expect(writer.closed).rejects.toThrow('The micro:bit was disconnected.');
		await expect(writer.write(new TextEncoder().encode('late'))).rejects.toThrow(
			'The micro:bit was disconnected.'
		);
		expect(transport.dataListeners.size).toBe(0);
		expect(port.readable).toBeNull();
	});

	it('flushes a trailing partial UTF-8 sequence when writable input ends', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const writer = port.writable!.getWriter();
		const bytes = new TextEncoder().encode('café');
		await writer.write(bytes.slice(0, 4));
		await writer.close();
		writer.releaseLock();
		await port.close();

		expect(transport.writes.join('')).toBe('caf�');
	});

	it('refuses to pretend an unsupported WebUSB baud was applied', async () => {
		await expect(port.open({ baudRate: 9600 })).rejects.toThrow(`${SERIAL_BAUD_RATE} baud only`);
		expect(transport.dataListeners.size).toBe(0);
	});
});
