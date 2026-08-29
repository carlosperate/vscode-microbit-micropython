import { describe, expect, it, vi } from 'vitest';

import { SerialWriteGate } from '../src/serial/transport';
import type { SerialTransport } from '../src/serial/types';

const transport = (write: (data: string) => Promise<void>): SerialTransport => ({
	onData: () => () => undefined,
	onDisconnect: () => () => undefined,
	write,
});

describe('serial write coordination', () => {
	it('drains an accepted write and drops input while an exclusive operation runs', async () => {
		const events: string[] = [];
		let finishWrite: (() => void) | undefined;
		const gate = new SerialWriteGate(
			transport((data) => {
				events.push(`write ${data}`);
				if (data !== 'before') return Promise.resolve();
				return new Promise<void>((resolve) => {
					finishWrite = resolve;
				});
			})
		);

		const before = gate.write('before');
		await Promise.resolve();
		const exclusive = gate.withWritesBlocked(async () => {
			events.push('flash');
		});
		await gate.write('during');
		expect(events).toEqual(['write before']);

		finishWrite?.();
		await before;
		await exclusive;
		await gate.write('after');

		expect(events).toEqual(['write before', 'flash', 'write after']);
	});

	it('reports how much input it dropped, once, however many holds were nested', async () => {
		const writes: string[] = [];
		const reported: number[] = [];
		const gate = new SerialWriteGate(
			transport(async (data) => {
				writes.push(data);
			}),
			(characters) => reported.push(characters)
		);

		await gate.withWritesBlocked(async () => {
			await gate.write('print(1)');
			await gate.withWritesBlocked(async () => {
				await gate.write('\r');
			});
			expect(reported).toEqual([]);
		});

		expect(writes).toEqual([]);
		expect(reported).toEqual(['print(1)\r'.length]);

		// A hold that dropped nothing has nothing to say.
		await gate.withWritesBlocked(async () => undefined);
		expect(reported).toEqual(['print(1)\r'.length]);
	});

	/**
	 * A write that never settles must not be able to hold the device. Flashing waits
	 * for accepted input to go out before it starts, and the command that asked has
	 * already latched its own "one at a time" flag, so a wait with no end leaves
	 * every later attempt refusing until the window is reloaded.
	 */
	it('goes ahead with a hold when an accepted write never finishes, and types again after', async () => {
		vi.useFakeTimers();
		try {
			const writes: string[] = [];
			const gate = new SerialWriteGate(
				transport(async (data) => {
					if (data === 'stuck') return new Promise<void>(() => undefined);
					writes.push(data);
				})
			);
			void gate.write('stuck');

			let ran = false;
			const held = gate.withWritesBlocked(async () => {
				ran = true;
			});

			await vi.advanceTimersByTimeAsync(1999);
			expect(ran).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await held;
			expect(ran).toBe(true);

			// The terminal has to survive the write that stalled, or it is silent for
			// the rest of the session: the gate outlives every terminal it feeds.
			await gate.write('after');
			expect(writes).toEqual(['after']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('continues serializing writes after one fails', async () => {
		const writes: string[] = [];
		const gate = new SerialWriteGate(
			transport(async (data) => {
				writes.push(data);
				if (data === 'bad') throw new Error('failed');
			})
		);

		await expect(gate.write('bad')).rejects.toThrow('failed');
		await expect(gate.write('good')).resolves.toBeUndefined();
		expect(writes).toEqual(['bad', 'good']);
	});
});
