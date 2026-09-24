import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { COMMANDS } from '../src/config';
import { commandFor } from '../src/simulator/controls';
import { SHELL_CONTROLS } from '../src/simulator/protocol';

const contributed = new Set(manifest.contributes.commands.map((command) => command.command));

/**
 * The buttons in the simulator document post a control and the view turns it
 * into a command, so a wrong mapping is a button that logs and does nothing.
 */
describe('the buttons in the simulator document', () => {
	it('run the simulator terminal as our own command', () => {
		expect(commandFor('terminal')).toBe(COMMANDS.openSimulatorTerminal);
	});

	it('name only commands the manifest contributes', () => {
		for (const control of SHELL_CONTROLS) {
			const command = commandFor(control);
			if (command) expect(contributed.has(command), control).toBe(true);
		}
	});

	it('leave Stop, Reset and Mute to the document', () => {
		for (const control of ['stop', 'reset', 'sound'] as const) {
			expect(commandFor(control)).toBeUndefined();
		}
	});
});
