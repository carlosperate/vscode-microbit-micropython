/**
 * Whether the simulator document has said it is up. Pure, so the wait and its
 * timeout can be tested without a webview.
 */

export type Readiness = { kind: 'ready' } | { kind: 'failed'; detail: string } | { kind: 'timeout' };

export class ReadyGate {
	private state: Readiness | undefined;
	private waiting: ((state: Readiness) => void)[] = [];

	/** A new document is loading, so nothing is known about it yet. */
	reset(): void {
		this.state = undefined;
	}

	current(): Readiness | undefined {
		return this.state;
	}

	settle(state: Readiness): void {
		this.state = state;
		for (const resolve of this.waiting.splice(0)) resolve(state);
	}

	/** Answers at once if the document has already spoken, else when it does or the time runs out. */
	wait(timeoutMs: number): Promise<Readiness> {
		if (this.state) return Promise.resolve(this.state);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.waiting = this.waiting.filter((waiter) => waiter !== settle);
				resolve({ kind: 'timeout' });
			}, timeoutMs);
			const settle = (state: Readiness) => {
				clearTimeout(timer);
				resolve(state);
			};
			this.waiting.push(settle);
		});
	}
}
