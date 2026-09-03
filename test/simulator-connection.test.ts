import { beforeEach, describe, expect, it } from 'vitest';

import { SimulatorTransport, type SimulatorLink } from '../src/simulator/connection';
import type { FromShell, SimulatorMessage, ToShell } from '../src/simulator/protocol';

class FakeLink implements SimulatorLink {
	public readonly messageListeners = new Set<(message: FromShell) => void>();
	public readonly disposeListeners = new Set<() => void>();
	public readonly posted: ToShell[] = [];

	public onMessage(listener: (message: FromShell) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	public onDisposed(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public post(message: ToShell): void {
		this.posted.push(message);
	}

	public shellSays(message: FromShell): void {
		for (const listener of this.messageListeners) listener(message);
	}

	public dispose(): void {
		for (const listener of this.disposeListeners) listener();
	}
}

const notification = (notification: SimulatorMessage): FromShell => ({ kind: 'notification', notification });
const control = (control: 'stop' | 'reset' | 'sound'): FromShell => ({ kind: 'control', control });
const terminal = (open: boolean): ToShell => ({ kind: 'terminal', open });

let link: FakeLink;
let transport: SimulatorTransport;

beforeEach(() => {
	link = new FakeLink();
	transport = new SimulatorTransport(link);
});

describe('the simulator as a serial transport', () => {
	it('passes serial output through as text and nothing else', () => {
		const received: string[] = [];
		transport.onData((data) => received.push(data));

		link.shellSays(notification({ kind: 'serial_output', data: '>>> ' }));
		link.shellSays(notification({ kind: 'state_change', change: {} }));
		link.shellSays(notification({ kind: 'request_flash' }));
		link.shellSays({ kind: 'ready' });
		link.shellSays(control('reset'));

		expect(received).toEqual(['>>> ']);
	});

	it('writes keystrokes as serial input', async () => {
		await transport.write('\x03');
		await transport.write('print(1)\r');

		expect(link.posted).toEqual([
			{ kind: 'command', command: { kind: 'serial_input', data: '\x03' } },
			{ kind: 'command', command: { kind: 'serial_input', data: 'print(1)\r' } },
		]);
	});

	/**
	 * The table this pins: Stop and a disposed view close the terminal; Reset and
	 * a flash keep it, since the interpreter comes straight back; and nothing the
	 * simulator says on its own counts, since it never announces a stop.
	 */
	it('disconnects on Stop and on disposal, and on nothing else', () => {
		let disconnects = 0;
		transport.onDisconnect(() => disconnects++);

		link.shellSays(control('reset'));
		link.shellSays(control('sound'));
		link.shellSays(notification({ kind: 'request_flash' }));
		link.shellSays(notification({ kind: 'serial_output', data: 'MicroPython' }));
		link.shellSays({ kind: 'error', detail: 'Already running!' });
		expect(disconnects).toBe(0);

		link.shellSays(control('stop'));
		expect(disconnects).toBe(1);

		link.dispose();
		expect(disconnects).toBe(2);
	});

	it('detaches both halves of a disconnect listener at once', () => {
		let disconnects = 0;
		const stop = transport.onDisconnect(() => disconnects++);
		const stopData = transport.onData(() => undefined);
		expect(link.messageListeners.size).toBe(2);
		expect(link.disposeListeners.size).toBe(1);

		stop();
		stopData();
		link.shellSays(control('stop'));
		link.dispose();

		expect(disconnects).toBe(0);
		expect(link.messageListeners.size).toBe(0);
		expect(link.disposeListeners.size).toBe(0);
	});

	/**
	 * A reader attaching is a terminal opening and its detaching is the terminal
	 * closing, whichever way it closed. The shell hears each transition once, so an
	 * unsubscribe called twice, or a second reader, cannot make it say "closed" early.
	 */
	it('tells the shell when the first terminal opens and the last one closes', () => {
		const first = transport.onData(() => undefined);
		expect(link.posted).toEqual([terminal(true)]);

		const second = transport.onData(() => undefined);
		first();
		first();
		expect(link.posted).toEqual([terminal(true)]);

		second();
		expect(link.posted).toEqual([terminal(true), terminal(false)]);

		transport.onData(() => undefined);
		expect(link.posted).toEqual([terminal(true), terminal(false), terminal(true)]);
	});
});
