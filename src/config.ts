/**
 * The ids VS Code knows us by. Every one of these also appears in package.json,
 * and the two are compared at runtime by the integration tests: a manifest entry
 * with no handler shows in the palette and throws when clicked, which nothing
 * else in the toolchain can see.
 *
 * All of them are prefixed with the extension's own name. `microbit.*` belongs
 * to the micro:bit Foundation's extension pack.
 */
export const COMMANDS = {
	flash: 'microbit-micropython.flash',
	saveHex: 'microbit-micropython.saveHex',
	connect: 'microbit-micropython.connect',
	disconnect: 'microbit-micropython.disconnect',
	openTerminal: 'microbit-micropython.openTerminal',
	resetBoard: 'microbit-micropython.resetBoard',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** The settings section, and the keys inside it, as the manifest declares them. */
export const SECTION = 'microbit-micropython';
export const SETTINGS = {
	filesExclude: 'files.exclude',
} as const;

/**
 * The user-facing name, and it always carries MicroPython. This is not a generic
 * micro:bit extension: the board is also programmed in C++ and MakeCode, and the
 * Foundation's own extension pack contributes commands under a bare `micro:bit`
 * category. Anywhere a user reads a name, it has to say which of those this is.
 *
 * Matches `displayName` and the `category` on every contributed command, which
 * is what VS Code renders as the `micro:bit MicroPython: ` palette prefix.
 */
export const PRODUCT = 'micro:bit MicroPython';
