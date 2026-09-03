/**
 * The simulator's serial port as a transport, so the same adapter that makes a
 * WebUSB board an Eclipse terminal makes the simulator one. Pure: the view lends
 * it the shell's messages and a way to post, and it imports nothing of VS Code.
 */
import type { SerialTransport } from '../serial/types';
import type { FromShell, ToShell } from './protocol';

/** What the view lends: everything the shell says, the view going away, and a way to answer. */
export interface SimulatorLink {
	onMessage(listener: (message: FromShell) => void): () => void;
	onDisposed(listener: () => void): () => void;
	post(message: ToShell): void;
}

/**
 * Disconnect is whatever takes the interpreter away for good: our Stop button, or
 * the view being disposed. Reset and a flash build another module at once, so the
 * terminal survives them as a board's port survives its reset button, and a
 * finished program drops into the REPL, as hardware does.
 */
export class SimulatorTransport implements SerialTransport {
	private readers = 0;

	public constructor(private readonly link: SimulatorLink) {}

	/**
	 * A reader is a terminal: Eclipse attaches one when it opens the port and
	 * cancels it when the terminal closes, however it closes. So the count is what
	 * tells the shell whether to say a terminal is open.
	 */
	public onData(listener: (data: string) => void): () => void {
		const stop = this.link.onMessage((message) => {
			if (message.kind !== 'notification' || message.notification.kind !== 'serial_output') return;
			listener(String(message.notification.data));
		});
		if (this.readers++ === 0) this.link.post({ kind: 'terminal', open: true });

		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			stop();
			if (--this.readers === 0) this.link.post({ kind: 'terminal', open: false });
		};
	}

	public onDisconnect(listener: () => void): () => void {
		const stopped = this.link.onMessage((message) => {
			if (message.kind === 'control' && message.control === 'stop') listener();
		});
		const disposed = this.link.onDisposed(listener);
		return () => {
			stopped();
			disposed();
		};
	}

	/** Upstream buffers input and clears it on every start and stop, so nothing typed can run stale. */
	public async write(data: string): Promise<void> {
		this.link.post({ kind: 'command', command: { kind: 'serial_input', data } });
	}
}
