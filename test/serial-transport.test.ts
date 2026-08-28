import { describe, expect, it } from 'vitest';

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
