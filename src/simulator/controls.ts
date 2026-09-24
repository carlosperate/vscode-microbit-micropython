/**
 * Which command a button in the simulator document runs. Stop, Reset and Mute
 * never leave the document, so they map to nothing.
 */
import { COMMANDS } from '../config';
import type { ShellControl } from './protocol';

export function commandFor(control: ShellControl): string | undefined {
	return control === 'terminal' ? COMMANDS.openSimulatorTerminal : undefined;
}
