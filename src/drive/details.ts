/**
 * What a micro:bit says about itself in `DETAILS.TXT`, the file DAPLink puts at
 * the root of the drive it mounts.
 */
import type { BoardVersion } from '../hex/build';

/**
 * The board ids DAPLink writes, as the four hex digits they appear as. The same
 * list `@microbit/microbit-connection` validates against, and it grows with each
 * hardware revision, so an id missing from it must fall back to a hex that runs
 * on every board rather than guess at a version.
 */
const BOARDS: Record<string, BoardVersion> = {
	'9900': 'V1',
	'9901': 'V1',
	'9903': 'V2',
	'9904': 'V2',
	'9905': 'V2',
	'9906': 'V2',
};

/** Newer interface builds write the id on a line of its own. */
const BOARD_ID = /^\s*Board ID:\s*([0-9a-f]{4})\b/im;

/** Older ones only carry it as the first four digits of the unique id. */
const UNIQUE_ID = /^\s*Unique ID:\s*([0-9a-f]{4})/im;

/** `undefined` for anything unrecognised, including a file that was truncated. */
export function boardVersion(details: string): BoardVersion | undefined {
	const id = BOARD_ID.exec(details)?.[1] ?? UNIQUE_ID.exec(details)?.[1];
	return id ? BOARDS[id.toLowerCase()] : undefined;
}
