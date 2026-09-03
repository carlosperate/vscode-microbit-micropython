/**
 * The panel's contents, over a `ready` payload captured from the running
 * simulator rather than written here: a hand-made fixture would only prove that
 * two copies of our own assumptions agree. Re-capture it when the simulator is
 * bumped, as `dev.md` says.
 */
import { describe, expect, it } from 'vitest';

import { clearValue, sensorControls, setValueFor, withChange, type Control } from '../src/simulator/sensors';
import state from './fixtures/simulator-ready.json';

const controls = sensorControls(state);
const byId = (id: string) => controls.find((control) => control.id === id);

/** Everything the board itself already offers, and so is not repeated here. */
const ON_THE_BOARD = ['buttonA', 'buttonB', 'pinLogo'];

describe('what the panel shows', () => {
	it('lists every sensor the board reports, in the order a learner meets them', () => {
		expect(controls.map((control) => control.label)).toEqual([
			'Accelerometer X',
			'Accelerometer Y',
			'Accelerometer Z',
			'Gesture',
			'Light level',
			'Temperature',
			'Sound level',
			'Compass X',
			'Compass Y',
			'Compass Z',
			'Compass heading',
			'Pin 0 touch',
			'Pin 1 touch',
			'Pin 2 touch',
		]);
	});

	/**
	 * Measured on the board: with a pin's value at 1, `pin0.is_touched()` answers
	 * True and `pin0.read_digital()` still answers 0. Upstream wires a pin to touch
	 * and to nothing else, so a label saying "Pin 0" promises an input the
	 * simulator does not have.
	 */
	it('says touch on the pins, since that is all a pin drives', () => {
		for (const id of ['pin0', 'pin1', 'pin2']) expect(byId(id)?.label, id).toMatch(/touch$/);
	});

	/** A second control for these could disagree with the board's own. */
	it('leaves out what the board already carries', () => {
		for (const id of ON_THE_BOARD) expect(byId(id), id).toBeUndefined();
	});

	/**
	 * The state holds more than sensors, and a later simulator may hold more
	 * still. `type` is the filter, so an entry that is not a sensor is not a
	 * broken slider.
	 */
	it('renders only the entries that are sensors', () => {
		expect(byId('radio')).toBeUndefined();
		expect(byId('dataLogging')).toBeUndefined();
		expect(sensorControls({ invented: { type: 'somethingNew', id: 'invented' } })).toEqual([]);
	});

	/**
	 * The whole point of reading the payload: a sensor added upstream has to
	 * appear here without a change in this repository. Failing this means the
	 * fixture was re-captured and a new sensor needs a label and a place.
	 */
	it('accounts for every id in the payload', () => {
		const shown = new Set(controls.map((control) => control.id));
		const missing = Object.entries(state as Record<string, { type?: string }>)
			.filter(([id, entry]) => (entry.type === 'range' || entry.type === 'enum') && !shown.has(id))
			.map(([id]) => id);
		expect(missing, 'give these a label and a place in the order').toEqual(ON_THE_BOARD);
	});

	it('takes the kind from the range and never from the id', () => {
		expect(byId('pin0')?.kind).toBe('toggle');
		expect(byId('temperature')?.kind).toBe('slider');
		expect(byId('gesture')?.kind).toBe('enum');
	});

	it('carries the payload’s own range and unit', () => {
		expect(byId('temperature')).toEqual({
			id: 'temperature',
			label: 'Temperature',
			kind: 'slider',
			value: 21,
			min: -5,
			max: 50,
			unit: '°C',
		});
		// Not every sensor has one, and an empty unit is not shown as a space.
		expect(byId('lightLevel')).not.toHaveProperty('unit');
	});

	/**
	 * The select picks a gesture to fire rather than showing one the board is in,
	 * so it opens on the gesture a lesson actually asks for instead of on `none`.
	 * Every other choice keeps the board's own order, so a new one still appears.
	 */
	it('leads the gesture list with shake, trails it with none, and offers shake ready to send', () => {
		const gesture = byId('gesture') as Control & { kind: 'enum' };
		expect(gesture.value).toBe('shake');
		expect(gesture.choices).toEqual([
			'shake',
			'up',
			'down',
			'left',
			'right',
			'face up',
			'face down',
			'freefall',
			'3g',
			'6g',
			'8g',
			'none',
		]);
	});

	it('leaves an enum alone when the board has no shake to lead with', () => {
		const [only] = sensorControls({
			mood: { type: 'enum', id: 'mood', choices: ['calm', 'cross'], value: 'cross' },
		});
		expect(only?.kind === 'enum' && only.choices).toEqual(['calm', 'cross']);
		// Not resting, so it is shown as it is.
		expect(only?.value).toBe('cross');
	});

	/** A simulator bump adds sensors for free, or it is not reading the payload. */
	it('names a sensor it has never heard of', () => {
		const [invented] = sensorControls({
			soundPressure: { type: 'range', id: 'soundPressure', min: 0, max: 10, value: 1 },
		});
		expect(invented?.label).toBe('Sound pressure');
	});

	it('puts an unknown sensor after the known ones', () => {
		const list = sensorControls({
			soundPressure: { type: 'range', id: 'soundPressure', min: 0, max: 10, value: 1 },
			temperature: { type: 'range', id: 'temperature', min: -5, max: 50, value: 21 },
		});
		expect(list.map((control) => control.id)).toEqual(['temperature', 'soundPressure']);
	});

	/** A slider with no `min` posts NaN, which throws inside the simulator. */
	it('drops an entry it could not draw', () => {
		expect(sensorControls({ broken: { type: 'range', id: 'broken', max: 10, value: 1 } })).toEqual([]);
		expect(sensorControls({ empty: { type: 'enum', id: 'empty', value: 'x', choices: 'no' } })).toEqual([]);
		expect(sensorControls({ backwards: { type: 'range', id: 'backwards', min: 5, max: 5, value: 5 } })).toEqual([]);
	});

	it('answers with nothing for a payload that is not a state at all', () => {
		for (const nonsense of [undefined, null, 'ready', 42]) expect(sensorControls(nonsense)).toEqual([]);
	});
});

describe('what the panel sends', () => {
	const temperature = byId('temperature') as Control & { kind: 'slider' };
	const pin0 = byId('pin0') as Control & { kind: 'toggle' };
	const gesture = byId('gesture') as Control & { kind: 'enum' };

	it('sends the id and a number', () => {
		expect(setValueFor(temperature, 21)).toEqual({ kind: 'set_value', id: 'temperature', value: 21 });
	});

	/**
	 * Out of range throws inside the simulator's own listener, where it reaches no
	 * catch of ours and lands in the output channel as an uncaught error.
	 */
	it('clamps to the range the board gave', () => {
		expect(setValueFor(temperature, 999).value).toBe(50);
		expect(setValueFor(temperature, -999).value).toBe(-5);
	});

	/** A string value is `parseInt`ed upstream, so a fraction would truncate silently. */
	it('rounds, and sends a number even when the input hands over a string', () => {
		expect(setValueFor(temperature, '21.6').value).toBe(22);
		expect(setValueFor(temperature, '21').value).toBe(21);
		expect(typeof setValueFor(temperature, '21').value).toBe('number');
	});

	it('sends a toggle as 0 or 1', () => {
		expect(setValueFor(pin0, 1)).toEqual({ kind: 'set_value', id: 'pin0', value: 1 });
		expect(setValueFor(pin0, 0).value).toBe(0);
		expect(setValueFor(pin0, 7).value).toBe(1);
	});

	it('sends a choice as the string it is', () => {
		expect(setValueFor(gesture, 'shake')).toEqual({ kind: 'set_value', id: 'gesture', value: 'shake' });
	});

	/**
	 * A gesture is an event, not a level: it is cleared straight after, or the
	 * board reads as shaken for ever and a second shake never fires. The clear has
	 * to be a value the board offers, since anything else throws.
	 */
	it('clears a gesture with a choice the board accepts', () => {
		expect(clearValue(gesture)).toBe('none');
		expect(gesture.choices).toContain(clearValue(gesture));
		expect(clearValue({ ...gesture, choices: ['still', 'shake'] })).toBe('still');
	});
});

describe('what the program changes', () => {
	it('follows a value the program wrote', () => {
		const changed = withChange(controls, { pin0: { type: 'range', id: 'pin0', min: 0, max: 1, value: 1 } });
		expect(changed.find((control) => control.id === 'pin0')?.value).toBe(1);
		// Everything else is left exactly as it was.
		expect(changed.filter((control) => control.id !== 'pin0')).toEqual(
			controls.filter((control) => control.id !== 'pin0')
		);
	});

	it('ignores a change for something it does not show', () => {
		expect(withChange(controls, { buttonA: { type: 'range', id: 'buttonA', min: 0, max: 1, value: 1 } })).toEqual(
			controls
		);
		expect(withChange(controls, { radio: { type: 'radio', enabled: true, group: 3 } })).toEqual(controls);
		expect(withChange(controls, undefined)).toEqual(controls);
	});

	/** A change that would turn a slider into a toggle is a change we do not take. */
	it('keeps the control it already drew', () => {
		const changed = withChange(controls, {
			temperature: { type: 'range', id: 'temperature', min: 0, max: 1, value: 1 },
		});
		expect(changed.find((control) => control.id === 'temperature')?.kind).toBe('slider');
	});
});
