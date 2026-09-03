import { COMMANDS } from '../config';

/** One row of `contributes.commands`, which is where the menu's titles come from. */
export interface Contributed {
	command: string;
	title: string;
}

/** In the order the work happens, which is neither the manifest's nor the palette's. */
const WORK: readonly string[] = [
	COMMANDS.flash,
	// Beside Flash because it is the other way to run the program; opening the
	// simulator without running anything is the detour, so it follows.
	COMMANDS.runInSimulator,
	COMMANDS.openSimulator,
	COMMANDS.openTerminal,
	COMMANDS.openSimulatorTerminal,
	COMMANDS.saveHex,
	COMMANDS.selectProjectFolder,
];

/**
 * Connect leads when nothing below it can work yet; Disconnect trails, since it
 * undoes the menu rather than using it. A command missing from here still
 * appears, at the end: dropping one silently would make it unreachable.
 */
export const menuOrder = (connected: boolean): readonly string[] =>
	connected ? [...WORK, COMMANDS.disconnect] : [COMMANDS.connect, ...WORK];

/**
 * The palette's own entries, ordered for a menu and minus whichever of Connect
 * and Disconnect is not the one to offer. Titles come from the manifest so the
 * two cannot drift apart.
 *
 * Every command stays listed regardless of WebUSB: picking one on a browser
 * that cannot use it is answered with a message when it runs, not by hiding
 * the entry, which only leaves someone wondering where the rest went.
 */
export function menuCommands(contributed: readonly Contributed[], connected: boolean | undefined): Contributed[] {
	const order = menuOrder(connected ?? false);
	// `filter` already answers with a new array, so the sort is not the caller's.
	return contributed
		.filter((entry) => allowed(entry.command, connected))
		.sort((a, b) => place(order, a.command) - place(order, b.command));
}

/**
 * An unknown `connected` is a host with no way to authorise a board at all, so
 * neither entry describes anything it can do and both go. Every other command
 * stays, because the board is not what they are for.
 */
function allowed(command: string, connected: boolean | undefined): boolean {
	if (command === COMMANDS.connect) return connected === false;
	if (command === COMMANDS.disconnect) return connected === true;
	// Contributed for the device section's header icon, and it opens this very menu.
	if (command === COMMANDS.showMenu) return false;
	return true;
}

/** Unplaced commands sort after every placed one, keeping their manifest order. */
const place = (order: readonly string[], command: string) => {
	const at = order.indexOf(command);
	return at === -1 ? order.length : at;
};
