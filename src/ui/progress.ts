import { ProgressStage, type BoardVersion } from '@microbit/microbit-connection';

import { PRODUCT } from '../config';

/** One `progress.report`: a label always, a bar movement only when there is one. */
export interface Step {
	message: string;
	/** Percentage points to add. VS Code takes deltas, the library gives totals. */
	increment?: number;
}

/**
 * All seven stages, including the two that only fire on native platforms, so a
 * version bump cannot render a blank label. `withProgress`'s own notification
 * renderer joins a non-empty `title` and a reported `message` as `${title}: ${message}`
 * unconditionally (`withNotificationProgress` in the workbench), so a static
 * title cannot end in a period: it would always read "…: detail". Every detail
 * here is instead the full sentence, and the caller passes no title at all.
 */
const DETAILS: Record<ProgressStage, string> = {
	Initializing: 'Getting ready',
	FindingDevice: 'Looking for the micro:bit',
	CheckingBond: 'Pairing with the micro:bit',
	ResettingDevice: 'Resetting the micro:bit',
	Connecting: 'Connecting to the micro:bit',
	PartialFlashing: 'Performing fast flash',
	// Not "the first time": a fallback from partial flashing hits this too.
	FullFlashing: 'Performing a full flash, which can take longer',
};

/**
 * Turns the library's stages into `withProgress` reports.
 *
 * It gives a total from 0 to 1, and only for the two flashing stages; VS Code
 * wants a delta, and cannot be moved backwards. So a partial flash falling back
 * to a full one keeps the bar where it was and says so in the label, which is
 * the only honest thing a one-directional bar can do.
 */
export function createProgress(version: BoardVersion): (stage: ProgressStage, progress?: number) => Step {
	let reported = 0;
	const prefix = `${PRODUCT}: flashing micro:bit ${version}.`;

	return (stage, progress) => {
		const detail = DETAILS[stage] ?? DETAILS[ProgressStage.Initializing];
		const message = `${prefix} ${detail}`;
		if (progress === undefined) return { message };

		const target = Math.min(Math.max(progress, 0), 1) * 100;
		const increment = Math.max(0, target - reported);
		reported += increment;
		return { message, increment };
	};
}
