/**
 * Naming the hex a save produces.
 *
 * The destination that matters is not the disk it is written to but the
 * `MICROBIT` DAPLink drive it gets dragged onto afterwards, which is FAT16, so
 * that is what every rule below is answering to.
 */

/** What makes the DAPLink drive take the file at all, so it is never dropped. */
const EXTENSION = '.hex';

/**
 * The whole filename, extension included, counted in code points and before the
 * nine characters a reserved-name escape adds. FAT's own limit is 255 UTF-16
 * units, which even a name made entirely of astral characters stays well inside
 * at this budget; the cap is here because past it a name stops helping, not
 * because FAT would refuse one.
 */
export const MAX_FILENAME = 64;

/**
 * Reserved device names, matched against the stem up to its first dot because
 * that is how far the rule reaches: `con`, `con.hex` and `con.old.hex` are all
 * refused. DOS, inherited by FAT and still enforced by Windows.
 */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * The name of the hex file created. Taken from the folder the code came from,
 * so they are easily distinguishable.
 *
 * Sanitised for FAT16, and for the extension appended at the end rather than for
 * the folder name alone: it counts against the length, it decides where the
 * trailing trim has to happen, and it is what puts a plain `con` inside the
 * reserved-name rule.
 *
 * Non-ASCII survives, so a learner whose folder is named in their own language
 * still recognises the file: FAT holds a long name as UCS-2, and the restricted
 * 8.3 alias beside it is the host's to generate and DAPLink's to read.
 */
export function hexFilename(folderName: string): string {
	const cleaned = folderName
		// Control and format characters: invisible, and illegal on FAT.
		.replace(/\p{C}+/gu, '-')
		// The nine characters FAT reserves in a long name.
		.replace(/[\\/:*?"<>|]+/g, '-')
		// Whitespace, so the name survives a shell or a URL unquoted.
		.replace(/\s+/g, '-')
		// One dash per run, whichever of the three above left them.
		.replace(/-{2,}/g, '-');

	// By code point, or the cut keeps half an emoji. Extension inside the budget.
	const short = [...cleaned].slice(0, MAX_FILENAME - EXTENSION.length).join('');

	// A leading dot hides the file; FAT strips a trailing one; the cut leaves them.
	const stem = short.replace(/^[-.]+|[-.]+$/g, '');

	// After the trim, which turns `con-` back into a reserved `con`.
	const named = RESERVED.test(stem) ? `microbit-${stem}` : stem || 'microbit';

	// Again: the prefix can push past the cap, and cannot become reserved itself.
	const capped = [...named].slice(0, MAX_FILENAME - EXTENSION.length).join('');
	return `${capped.replace(/[-.]+$/, '')}${EXTENSION}`;
}
