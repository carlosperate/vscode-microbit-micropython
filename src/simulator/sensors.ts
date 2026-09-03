/**
 * The sensor panel's contents, decided from the board's own `ready` state so a
 * simulator that gains a sensor gains a control with no change here. Pure: the
 * shell turns these into DOM, and nothing in this file knows what a slider is.
 */
import type { SimulatorMessage } from './protocol';

export type Control =
	| { id: string; label: string; kind: 'slider'; value: number; min: number; max: number; unit?: string }
	| { id: string; label: string; kind: 'toggle'; value: number }
	| { id: string; label: string; kind: 'enum'; value: string; choices: string[] };

/**
 * The board carries these three itself, as `role="button"` elements with labels
 * and focus styles, so a control here would be a second one able to disagree.
 */
const ON_THE_BOARD = ['buttonA', 'buttonB', 'pinLogo'];

/** Display order, and the labels, which say what the learner would type. */
const LABELS: Record<string, string> = {
	accelerometerX: 'Accelerometer X',
	accelerometerY: 'Accelerometer Y',
	accelerometerZ: 'Accelerometer Z',
	gesture: 'Gesture',
	lightLevel: 'Light level',
	temperature: 'Temperature',
	soundLevel: 'Sound level',
	compassX: 'Compass X',
	compassY: 'Compass Y',
	compassZ: 'Compass Z',
	compassHeading: 'Compass heading',
	// Touch, and never "Pin 0": the simulator wires a pin's value to `is_touched()`
	// alone, and `read_digital()` there answers 0 whatever this control says.
	pin0: 'Pin 0 touch',
	pin1: 'Pin 1 touch',
	pin2: 'Pin 2 touch',
};
const ORDER = Object.keys(LABELS);

/** `soundPressure` reads as `Sound pressure`, so a new sensor still gets a name. */
function labelFor(id: string): string {
	const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The gesture a lesson asks for first, and the value that means none is happening. */
const SHAKE = 'shake';
const RESTING = 'none';

/**
 * Shake leads and the resting value trails, since one is what a lesson asks for
 * and the other does nothing. Everything between keeps the board's own order, so
 * a gesture added upstream still appears.
 */
const leadWithShake = (choices: readonly string[]): string[] => {
	const middle = choices.filter((choice) => choice !== SHAKE && choice !== RESTING);
	return [
		...(choices.includes(SHAKE) ? [SHAKE] : []),
		...middle,
		...(choices.includes(RESTING) ? [RESTING] : []),
	];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * One state entry, or nothing. `type` is the discriminator and the names are
 * never it: `radio` and `dataLogging` sit in the same record and carry their own,
 * as would anything a later simulator adds.
 */
function control(id: string, entry: unknown): Control | undefined {
	if (!isRecord(entry)) return undefined;
	const label = LABELS[id] ?? labelFor(id);

	if (entry.type === 'range') {
		const { value, min, max, unit } = entry;
		if (!isNumber(value) || !isNumber(min) || !isNumber(max) || min >= max) return undefined;
		// Decided by the range and not by the id, which is what makes the pins toggles.
		if (min === 0 && max === 1) return { id, label, kind: 'toggle', value };
		return { id, label, kind: 'slider', value, min, max, ...(typeof unit === 'string' && unit ? { unit } : {}) };
	}

	if (entry.type === 'enum') {
		const { value, choices } = entry;
		if (typeof value !== 'string') return undefined;
		if (!Array.isArray(choices) || !choices.every((choice) => typeof choice === 'string')) return undefined;
		const ordered = leadWithShake(choices as string[]);
		// The select picks the gesture to fire, so resting on `none` offers nothing.
		const shown = value === RESTING && ordered.length ? ordered[0] : value;
		return { id, label, kind: 'enum', value: shown, choices: ordered };
	}

	return undefined;
}

/** The panel, in order: the ones named above, then anything new, as it came. */
export function sensorControls(state: unknown): Control[] {
	if (!isRecord(state)) return [];
	const ids = Object.keys(state).filter((id) => !ON_THE_BOARD.includes(id));
	const rank = (id: string) => (ORDER.indexOf(id) === -1 ? ORDER.length : ORDER.indexOf(id));
	return ids
		.map((id, at) => ({ id, at }))
		.sort((a, b) => rank(a.id) - rank(b.id) || a.at - b.at)
		.map(({ id }) => control(id, state[id]))
		.filter((entry): entry is Control => entry !== undefined);
}

/**
 * Clamped and whole, because a value outside the range throws inside the
 * simulator's own listener, and a string one is `parseInt`ed there instead.
 */
export function setValueFor(control: Control, raw: number | string): SimulatorMessage {
	if (control.kind === 'enum') return { kind: 'set_value', id: control.id, value: String(raw) };
	const [min, max] = control.kind === 'toggle' ? [0, 1] : [control.min, control.max];
	const value = Math.min(max, Math.max(min, Math.round(Number(raw) || 0)));
	return { kind: 'set_value', id: control.id, value };
}

/**
 * What a fired gesture is set back to. Upstream's own embedder uses `none`, but
 * the value has to be one the board offers or it throws.
 */
export const clearValue = (control: Control & { kind: 'enum' }): string =>
	control.choices.includes(RESTING) ? RESTING : control.choices[0];

/** The program's own changes, from `state_change`, which never come back to it. */
export function withChange(controls: readonly Control[], change: unknown): Control[] {
	if (!isRecord(change)) return [...controls];
	return controls.map((existing) => {
		const entry = change[existing.id];
		if (!isRecord(entry)) return existing;
		const updated = control(existing.id, entry);
		return updated && updated.kind === existing.kind ? updated : existing;
	});
}
