/**
 * Command ids are duplicated in package.json because VS Code reads the manifest.
 * Integration tests catch drift, and the extension prefix avoids collisions with
 * the micro:bit Foundation's `microbit.*` commands.
 */
export const COMMANDS = {
	createProject: 'bbcmicrobit-micropython.createProject',
	flash: 'bbcmicrobit-micropython.flash',
	saveHex: 'bbcmicrobit-micropython.saveHex',
	selectProjectFolder: 'bbcmicrobit-micropython.selectProjectFolder',
	openSimulator: 'bbcmicrobit-micropython.openSimulator',
	runInSimulator: 'bbcmicrobit-micropython.runInSimulator',
	openSimulatorTerminal: 'bbcmicrobit-micropython.openSimulatorTerminal',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** This extension's own id, whose page a message opens when this is the extension to update. */
export const EXTENSION_ID = 'carlosperate.bbcmicrobit-micropython';

/** The settings section, and the keys inside it, as the manifest declares them. */
export const SECTION = 'bbcmicrobit-micropython';
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

/** The Open VSX companion that owns every terminal, which here is the simulator's REPL. */
export const SERIAL_MONITOR_EXTENSION = 'eclipse-cdt.serial-monitor';

/**
 * The extension that owns the board, the serial terminal and the micro:bit
 * status bar menu. This one builds a hex and hands it over; every byte that
 * reaches a board goes through there.
 */
export const MANAGER_EXTENSION = 'carlosperate.bbcmicrobit-manager';

/** The manager API this extension was built against, as the types package versions it. */
export const MANAGER_API_VERSION = '0.3.0';

/**
 * This extension's own activity bar container. No dot in it: the workbench
 * schema for a container id is `/^[a-z0-9_-]+$/i`, and one that does not
 * resolve sends its views to the Explorer with nothing but a log line.
 */
export const CONTAINER_ID = 'bbcmicrobit-micropython';
