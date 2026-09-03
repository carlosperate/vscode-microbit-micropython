/**
 * The wait for the simulator document, which is what stops Run in Simulator
 * hanging on a document that never loads.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadyGate } from '../src/simulator/ready';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('answers at once when the document has already spoken', async () => {
	const gate = new ReadyGate();
	gate.settle({ kind: 'ready' });
	await expect(gate.wait(1000)).resolves.toEqual({ kind: 'ready' });
});

it('answers when the document speaks, and cancels the timeout', async () => {
	const gate = new ReadyGate();
	const waited = gate.wait(1000);
	gate.settle({ kind: 'failed', detail: 'no wasm' });
	await expect(waited).resolves.toEqual({ kind: 'failed', detail: 'no wasm' });
	// Nothing left to fire: a late timeout must not answer a settled wait twice.
	expect(vi.getTimerCount()).toBe(0);
});

it('times out when nothing arrives, and a late answer does not resurrect it', async () => {
	const gate = new ReadyGate();
	const waited = gate.wait(1000);
	vi.advanceTimersByTime(1000);
	await expect(waited).resolves.toEqual({ kind: 'timeout' });
	gate.settle({ kind: 'ready' });
	await expect(gate.wait(1000)).resolves.toEqual({ kind: 'ready' });
});

/** Revealing a view retries a failed load, which is what this is read for. */
it('reports its current state, and none after a reset', () => {
	const gate = new ReadyGate();
	expect(gate.current()).toBeUndefined();
	gate.settle({ kind: 'failed', detail: 'no wasm' });
	expect(gate.current()).toEqual({ kind: 'failed', detail: 'no wasm' });
	gate.reset();
	expect(gate.current()).toBeUndefined();
});

/** A move rebuilds the document, and the old answer must not stand in for the new one. */
it('forgets a settled state on reset', async () => {
	const gate = new ReadyGate();
	gate.settle({ kind: 'ready' });
	gate.reset();
	const waited = gate.wait(1000);
	vi.advanceTimersByTime(1000);
	await expect(waited).resolves.toEqual({ kind: 'timeout' });
});
