/**
 * Command ids are duplicated in package.json because VS Code reads the manifest.
 * Integration tests catch drift, and the extension prefix avoids collisions with
 * the micro:bit Foundation's `microbit.*` commands.
 */
export const COMMANDS = {
	flash: 'bbcmicrobit-micropython.flash',
	saveHex: 'bbcmicrobit-micropython.saveHex',
	selectProjectFolder: 'bbcmicrobit-micropython.selectProjectFolder',
	openSimulator: 'bbcmicrobit-micropython.openSimulator',
	runInSimulator: 'bbcmicrobit-micropython.runInSimulator',
	openSimulatorTerminal: 'bbcmicrobit-micropython.openSimulatorTerminal',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** This extension's own id, which is what it registers its mode under. */
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
 * The extension that owns the board, the shared `BBC micro:bit` panel and the
 * mode switcher. This one builds a hex and hands it over; every byte that
 * reaches a board goes through there.
 */
export const MANAGER_EXTENSION = 'carlosperate.bbcmicrobit-manager';

/** The lowest manager API this extension works against, as the types package versions it. */
export const MANAGER_API_VERSION = '0.2.0';

/** The mode this extension registers, and the segment label a user reads. */
export const MODE_ID = 'micropython';
export const MODE_LABEL = 'MicroPython';

/** Set when the manager refused this extension, so the simulator can still show where the panel would be bare. */
export const REFUSED_CONTEXT = 'bbcmicrobit-micropython.refused';

/**
 * What gates the one view here: the manager naming this the active mode, or,
 * refused and with nothing else registered, the panel that would otherwise hold
 * only the manager's board buttons. The simulator needs no board.
 */
export const MODE_WHEN = `bbcmicrobit-manager.activeMode == ${MODE_ID} || (${REFUSED_CONTEXT} && bbcmicrobit-manager.noModes)`;

/** The shared activity bar container the manager declares. Never declared here. */
export const CONTAINER_ID = 'bbcmicrobit';
