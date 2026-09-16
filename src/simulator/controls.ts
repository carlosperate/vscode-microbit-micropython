/**
 * Which command a button in the simulator document runs. Stop, Reset and Mute
 * never leave the document, so they map to nothing; the board's terminal is the
 * manager's, read from its API rather than copied here.
 */
import { COMMANDS } from '../config';
import type { ShellControl } from './protocol';

export function commandFor(control: ShellControl, managerTerminal: () => string | undefined): string | undefined {
	switch (control) {
		case 'terminal':
			return COMMANDS.openSimulatorTerminal;
		case 'flash':
			return COMMANDS.flash;
		case 'serial':
			return managerTerminal();
		default:
			return undefined;
	}
}
