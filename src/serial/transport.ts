import type { SerialTransport } from './types';

/** Keeps terminal writes outside operations that need exclusive device access. */
export class SerialWriteGate implements SerialTransport {
	private pending: Promise<void> = Promise.resolve();
	private blockers = 0;

	public constructor(private readonly delegate: SerialTransport) {}

	public onData(listener: (data: string) => void): () => void {
		return this.delegate.onData(listener);
	}

	public onDisconnect(listener: () => void): () => void {
		return this.delegate.onDisconnect(listener);
	}

	public write(data: string): Promise<void> {
		// Queued input would execute stale commands after a flash resets the board.
		if (this.blockers > 0) return Promise.resolve();

		const result = this.pending.then(() => this.delegate.write(data));
		this.pending = result.catch(() => undefined);
		return result;
	}

	public async withWritesBlocked<T>(operation: () => Promise<T>): Promise<T> {
		this.blockers++;
		try {
			await this.pending;
			return await operation();
		} finally {
			this.blockers--;
		}
	}
}
