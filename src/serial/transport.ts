import type { SerialTransport } from './types';

/**
 * How long a hold waits for input already accepted to reach the board before
 * going ahead anyway. A write that never settles would otherwise hold the
 * command that asked for the device, with no way back but reloading the window,
 * and the line it is waiting on is one the flash was about to interrupt anyway.
 */
const DRAIN_LIMIT_MS = 2000;

/** Keeps terminal writes outside operations that need exclusive device access. */
export class SerialWriteGate implements SerialTransport {
	private pending: Promise<void> = Promise.resolve();
	private blockers = 0;
	private discarded = 0;

	/**
	 * `report` is told how much input was dropped, once the device is free again.
	 * The terminal echoes every keystroke itself, so discarded input stays on
	 * screen looking accepted, and nothing else would ever say otherwise.
	 */
	public constructor(
		private readonly delegate: SerialTransport,
		private readonly report: (characters: number) => void = () => undefined
	) {}

	public onData(listener: (data: string) => void): () => void {
		return this.delegate.onData(listener);
	}

	public onDisconnect(listener: () => void): () => void {
		return this.delegate.onDisconnect(listener);
	}

	public write(data: string): Promise<void> {
		// Queued input would execute stale commands after a flash resets the board.
		if (this.blockers > 0) {
			this.discarded += data.length;
			return Promise.resolve();
		}

		const result = this.pending.then(() => this.delegate.write(data));
		this.pending = result.catch(() => undefined);
		return result;
	}

	public async withWritesBlocked<T>(operation: () => Promise<T>): Promise<T> {
		const nested = this.blockers > 0;
		this.blockers++;
		try {
			// A nested hold has nothing to drain: writes stopped when the outer one began.
			if (!nested) await this.drain();
			return await operation();
		} finally {
			this.blockers--;
			// Nested holds are one wait to whoever is typing, so only the last reports.
			if (this.blockers === 0 && this.discarded > 0) {
				const characters = this.discarded;
				this.discarded = 0;
				this.report(characters);
			}
		}
	}

	/**
	 * Waits for accepted input to reach the board, then abandons whatever is left.
	 * A write is dropped from the chain rather than waited on twice: everything
	 * later is queued behind it, so keeping a stalled one would silence the
	 * terminal for good, where letting it go costs at most the bytes already lost.
	 */
	private async drain(): Promise<void> {
		// `ReturnType`, because node's types are in scope for `test/` and retype this.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const limit = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, DRAIN_LIMIT_MS);
		});
		try {
			await Promise.race([this.pending, limit]);
		} finally {
			clearTimeout(timer);
		}

		// Safe unconditionally: writes are refused throughout a hold, so nothing has
		// joined the chain since the wait began.
		this.pending = Promise.resolve();
	}
}
