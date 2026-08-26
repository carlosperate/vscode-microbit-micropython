import { ConnectionStatus, type BoardVersion } from '@microbit/microbit-connection';

import { PRODUCT } from '../config';

/** What the status bar item shows for one connection status. */
export interface StatusDisplay {
	text: string;
	tooltip: string;
	/**
	 * The tooltip without the product name, for the output channel. The library
	 * logs its own transitions there in its enum's vocabulary, and
	 * `NoAuthorizedDevice` after a board is unplugged reads as though the board was
	 * never allowed rather than as though it went away.
	 */
	summary: string;
}

/**
 * Exhaustive over the status enum, so a value added upstream fails the build
 * rather than rendering an empty status bar item. `named` puts the board version
 * in the text, which is how a user tells which firmware a flash will use.
 *
 * `Paused` means the library suspended the connection for a hidden tab, never
 * anything about flashing, and it is unreachable here: the listener that sets it
 * needs a `document`. It is worded plainly and nothing may be built on it.
 */
const DISPLAY: Record<ConnectionStatus, { icon: string; named: boolean; tooltip: (board: string) => string }> = {
	NoAuthorizedDevice: { icon: 'plug', named: false, tooltip: () => 'no micro:bit connected' },
	Disconnected: { icon: 'debug-disconnect', named: false, tooltip: () => 'micro:bit disconnected' },
	Connecting: { icon: 'loading~spin', named: false, tooltip: () => 'connecting to the micro:bit...' },
	Connected: { icon: 'plug', named: true, tooltip: (board) => `${board} connected` },
	Paused: { icon: 'debug-pause', named: true, tooltip: (board) => `${board} paused` },
};

/**
 * There is no colour here on purpose: VS Code offers only `warningBackground`
 * and `errorBackground`, which shout across the whole item, and "no board yet"
 * is the normal state for most of a session.
 */
export function describeStatus(status: ConnectionStatus, board?: BoardVersion): StatusDisplay {
	const { icon, named, tooltip } = DISPLAY[status] ?? DISPLAY[ConnectionStatus.NoAuthorizedDevice];
	const name = named && board ? `micro:bit ${board}` : 'micro:bit';
	const summary = tooltip(name);
	// The text stays short enough to live in a status bar; the product name that
	// tells this extension from every other micro:bit toolchain goes in the tooltip.
	return { text: `$(${icon}) ${name}`, tooltip: `${PRODUCT}: ${summary}`, summary };
}
