import { COMMANDS, NEEDS_USB } from '../config';

/** One row of `contributes.commands`, which is where the menu's titles come from. */
export interface Contributed {
	command: string;
	title: string;
}

/** What this host and this board can do, read fresh every time the menu opens. */
export interface Reachable {
	usb: boolean;
	/** Whether there is a board to hand back, which decides Connect against Disconnect. */
	connected: boolean;
}

/** In the order the work happens, which is neither the manifest's nor the palette's. */
const WORK: readonly string[] = [
	COMMANDS.flash,
	COMMANDS.openTerminal,
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
 * The palette's own entries, ordered for a menu and minus what cannot work now.
 * Titles come from the manifest so the two cannot drift apart.
 *
 * Connect and Disconnect are narrowed to one here and nowhere else: the palette
 * keeps both, because typing a command name has already said which is meant.
 */
export function menuCommands(contributed: readonly Contributed[], reachable: Reachable): Contributed[] {
	const order = menuOrder(reachable.connected);
	// `filter` already answers with a new array, so the sort is not the caller's.
	return contributed
		.filter((entry) => allowed(entry.command, reachable))
		.sort((a, b) => place(order, a.command) - place(order, b.command));
}

function allowed(command: string, { usb, connected }: Reachable): boolean {
	if (!usb && NEEDS_USB.includes(command)) return false;
	if (command === COMMANDS.connect) return !connected;
	if (command === COMMANDS.disconnect) return connected;
	return true;
}

/** Unplaced commands sort after every placed one, keeping their manifest order. */
const place = (order: readonly string[], command: string) => {
	const at = order.indexOf(command);
	return at === -1 ? order.length : at;
};
