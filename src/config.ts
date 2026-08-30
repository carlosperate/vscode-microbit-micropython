/**
 * Command ids are duplicated in package.json because VS Code reads the manifest.
 * Integration tests catch drift, and the extension prefix avoids collisions with
 * the micro:bit Foundation's `microbit.*` commands.
 */
export const COMMANDS = {
	flash: 'microbit-micropython.flash',
	saveHex: 'microbit-micropython.saveHex',
	selectProjectFolder: 'microbit-micropython.selectProjectFolder',
	connect: 'microbit-micropython.connect',
	disconnect: 'microbit-micropython.disconnect',
	openTerminal: 'microbit-micropython.openTerminal',
	/**
	 * Registered, deliberately not contributed. It opens a menu of the palette's
	 * own entries, so a palette entry for it would be noise.
	 */
	showMenu: 'microbit-micropython.showMenu',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** The settings section, and the keys inside it, as the manifest declares them. */
export const SECTION = 'microbit-micropython';
export const SETTINGS = {
	filesExclude: 'files.exclude',
	projectFolder: 'projectFolder',
} as const;

/** A setting as a user reads it in their own JSON, which is where they fix it. */
export const settingId = (key: (typeof SETTINGS)[keyof typeof SETTINGS]) => `${SECTION}.${key}`;

/**
 * The user-facing name distinguishes this extension from other micro:bit
 * toolchains and matches the manifest display name and command categories.
 */
export const PRODUCT = 'BBC micro:bit MicroPython';

/** The Open VSX companion that owns every serial terminal. */
export const SERIAL_MONITOR_EXTENSION = 'eclipse-cdt.serial-monitor';

/**
 * Set once this host is known to be able to authorise a board, and read by the
 * manifest to keep Connect and Disconnect out of the palette where it cannot.
 * A capability and not a host: a web workbench that stopped bridging the device
 * chooser would hide them too, which is the right answer there as well.
 */
export const CAN_PAIR_CONTEXT = 'microbit-micropython.canPair';
