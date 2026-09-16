import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { COMMANDS } from '../src/config';
import { commandFor } from '../src/simulator/controls';
import { SHELL_CONTROLS } from '../src/simulator/protocol';

const contributed = new Set(manifest.contributes.commands.map((command) => command.command));
const managerTerminal = () => 'bbcmicrobit-manager.openTerminal';

/**
 * The buttons in the simulator document post a control and the view turns it
 * into a command, so a wrong mapping is a button that logs and does nothing.
 */
describe('the buttons in the simulator document', () => {
	it("run Flash and the simulator terminal as our own commands, and the board terminal as the manager's", () => {
		expect(commandFor('flash', managerTerminal)).toBe(COMMANDS.flash);
		expect(commandFor('terminal', managerTerminal)).toBe(COMMANDS.openSimulatorTerminal);
		expect(commandFor('serial', managerTerminal)).toBe('bbcmicrobit-manager.openTerminal');
	});

	it('name only commands the manifest contributes, wherever they name one of ours', () => {
		for (const control of SHELL_CONTROLS) {
			const command = commandFor(control, () => undefined);
			if (command) expect(contributed.has(command), control).toBe(true);
		}
	});

	it('leave Stop, Reset and Mute to the document', () => {
		for (const control of ['stop', 'reset', 'sound'] as const) {
			expect(commandFor(control, managerTerminal)).toBeUndefined();
		}
	});

	/** The manager explains its own absence when asked; the view must not invent an id to run instead. */
	it('run nothing for the board terminal while the manager is not there', () => {
		expect(commandFor('serial', () => undefined)).toBeUndefined();
	});
});
