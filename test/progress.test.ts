import { ProgressStage } from '@microbit/microbit-connection';
import { describe, expect, it } from 'vitest';

import { createProgress } from '../src/ui/progress';

describe('what a flash reports while it runs', () => {
	it('has a label for every stage the library can report', () => {
		for (const stage of Object.values(ProgressStage)) {
			const { message, increment } = createProgress('V2')(stage);
			expect(message, stage).toMatch(/^[A-Z]/);
			// No value means a stage label and nothing else, never a bar movement.
			expect(increment, stage).toBeUndefined();
		}
	});

	/**
	 * The library gives a total from 0 to 1 and VS Code takes a delta, so getting
	 * this backwards is a bar that fills on the first callback and never moves.
	 */
	it('turns totals into the deltas VS Code wants', () => {
		const step = createProgress('V2');

		expect(step(ProgressStage.PartialFlashing, 0.25).increment).toBe(25);
		expect(step(ProgressStage.PartialFlashing, 0.5).increment).toBe(25);
		expect(step(ProgressStage.PartialFlashing, 1).increment).toBe(50);
	});

	/**
	 * A partial flash that falls back restarts its total at zero, and an
	 * increment cannot be negative: the bar holds where it was and the label is
	 * the only thing left to say what changed.
	 */
	it('never asks the bar to go backwards', () => {
		const step = createProgress('V2');
		step(ProgressStage.PartialFlashing, 0.8);

		const fallback = step(ProgressStage.FullFlashing, 0.1);
		expect(fallback.increment).toBe(0);
		expect(fallback.message).not.toBe(step(ProgressStage.PartialFlashing, 0.1).message);
	});

	it('adds up to one bar and no more, whatever it is given', () => {
		const step = createProgress('V2');
		const values = [0, 0.3, 0.2, 0.9, 1, 1];
		const total = values.reduce((sum, value) => sum + (step(ProgressStage.FullFlashing, value).increment ?? 0), 0);

		expect(total).toBe(100);
	});

	/** A library that ever reported outside its documented range must not overfill it. */
	it('clamps a value from outside the range', () => {
		const step = createProgress('V2');

		expect(step(ProgressStage.FullFlashing, -1).increment).toBe(0);
		expect(step(ProgressStage.FullFlashing, 5).increment).toBe(100);
	});

	/** The final callback of a flash carries no value, and must not disturb the bar. */
	it('leaves the bar alone on the closing callback', () => {
		const step = createProgress('V2');
		step(ProgressStage.PartialFlashing, 0.6);

		expect(step(ProgressStage.PartialFlashing, undefined).increment).toBeUndefined();
	});

	/**
	 * `withNotificationProgress` joins a non-empty `title` and the reported
	 * message as `${title}: ${message}` unconditionally, so a caller passing both
	 * gets "title: detail" whatever the detail says. The message here is the
	 * whole sentence and the caller passes no title, so it must never contain
	 * that pattern.
	 */
	it('names the board and reads as one sentence, not a title joined onto a detail', () => {
		const { message } = createProgress('V2')(ProgressStage.FullFlashing);

		expect(message).toBe('BBC micro:bit MicroPython: flashing micro:bit V2. Performing a full flash, which can take longer');
	});
});
