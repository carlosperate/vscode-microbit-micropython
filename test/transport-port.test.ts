import { beforeEach, describe, expect, it } from 'vitest';

import { SERIAL_BAUD_RATE, TransportSerialPort } from '../src/serial/transport-port';
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

const BOARD: SerialPortInfo = { usbVendorId: 0x0d28, usbProductId: 0x0204 };
const GONE = 'The micro:bit was disconnected.';

let transport: FakeTransport;
let port: TransportSerialPort;

beforeEach(() => {
	transport = new FakeTransport();
	port = new TransportSerialPort(transport, { info: BOARD, disconnected: GONE });
});

const readAll = async (readable: ReadableStream<Uint8Array>, chunks: number): Promise<string> => {
	const reader = readable.getReader();
	let text = '';
	for (let read = 0; read < chunks; read++) text += new TextDecoder().decode((await reader.read()).value);
	reader.releaseLock();
	return text;
};

describe('the Web Serial adapter over a transport', () => {
	/**
	 * Eclipse names a terminal from `getInfo()` when no name is passed, and reads
	 * `{}` as `Unknown Vendor - Unknown Product`, so what goes in must come out
	 * untouched: the ids for a board, and nothing at all for the simulator.
	 */
	it('hands back exactly the identity it was given', () => {
		expect(port.getInfo()).toEqual(BOARD);
		expect(new TransportSerialPort(transport, { info: {}, disconnected: GONE }).getInfo()).toEqual({});
	});

	/**
	 * The one line that says which device this is, since the simulator's REPL
	 * banner names the same board as hardware does. It has to land before anything
	 * the other end says, and a port given none prints nothing of its own.
	 */
	it('prints the banner first, as a line, and only when given one', async () => {
		const described = new TransportSerialPort(transport, {
			info: {},
			disconnected: GONE,
			banner: 'This terminal is connected to the simulator.',
		});
		await described.open({ baudRate: SERIAL_BAUD_RATE });
		transport.emitData('>>> ');
		expect(await readAll(described.readable!, 2)).toBe('This terminal is connected to the simulator.\n>>> ');
		await described.close();

		await port.open({ baudRate: SERIAL_BAUD_RATE });
		transport.emitData('>>> ');
		expect(await readAll(port.readable!, 1)).toBe('>>> ');
	});

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

	/**
	 * The terminal writes a keystroke at a time from its own fresh writer, without
	 * waiting for the last one and releasing the lock straight away, which is a
	 * different shape from the awaited writes above. A character the board's line
	 * editor then ignores, such as `é`, has to leave this side whole, or there is
	 * no telling the two losses apart.
	 */
	it('keeps a keystroke whole when written the way a terminal writes', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		for (const keystroke of ["'", 'é', "'", '\r']) {
			const writer = port.writable!.getWriter();
			void writer.write(new TextEncoder().encode(keystroke));
			writer.releaseLock();
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transport.writes.join('')).toBe("'é'\r");
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

	/** The message is the caller's: a board is disconnected, a simulator is stopped. */
	it('ends the stream with the given message when the other end goes away', async () => {
		await port.open({ baudRate: SERIAL_BAUD_RATE });
		const reader = port.readable!.getReader();
		const writer = port.writable!.getWriter();
		const reading = reader.read();
		transport.disconnect();

		await expect(reading).rejects.toThrow(GONE);
		await expect(writer.closed).rejects.toThrow(GONE);
		await expect(writer.write(new TextEncoder().encode('late'))).rejects.toThrow(GONE);
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

	it('refuses to pretend an unsupported baud was applied', async () => {
		await expect(port.open({ baudRate: 9600 })).rejects.toThrow(`${SERIAL_BAUD_RATE} baud only`);
		expect(transport.dataListeners.size).toBe(0);
	});
});
