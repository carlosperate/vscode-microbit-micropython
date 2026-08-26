/**
 * Which folder inside a workspace folder holds the micro:bit project.
 *
 * A repository usually keeps its code below the root, next to a readme and a
 * licence that have no business on a board, so the folder is settable. Both
 * directions live here: a path a user typed into settings, and a folder a user
 * picked in a dialog, which has to be turned back into a path to store.
 */

/** Why a configured value cannot be used. The wording belongs to the caller. */
export type Refusal = 'not-a-string' | 'outside-the-workspace';

/**
 * The segments below the workspace folder, empty for the folder itself, or the
 * reason there are none. A value rather than a thrown error, so the pure core
 * carries no message strings and the adapter decides what a user reads.
 */
export type ProjectPath = { segments: string[] } | { refused: Refusal };

/**
 * Anything opening with a scheme is a URI or a Windows drive, never relative.
 * The full scheme grammar, not just letters, or `vscode-vfs:` and `git+ssh:`
 * walk past it and get joined on as if they were folder names.
 */
const ROOTED = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A configured setting, as a path relative to the workspace folder.
 *
 * Forgiving about how it was written, because a human typed it into a JSON
 * file: either separator, a `./` prefix, a trailing slash. Unforgiving about
 * where it points, and **that check happens here, on the string**, because
 * `Uri.joinPath` resolves a `..` segment itself and hands back a URI outside the
 * workspace with nothing left to notice.
 */
export function projectPath(configured: unknown): ProjectPath {
	// Absent means the workspace folder, which is the default and the common case.
	if (configured === undefined) return { segments: [] };

	// A declared `"type": "string"` is a hint to the settings editor and nothing
	// more; whatever is in the JSON arrives here as it was written.
	if (typeof configured !== 'string') return { refused: 'not-a-string' };
	if (configured.trim() === '') return { segments: [] };

	if (ROOTED.test(configured) || /^[/\\]/.test(configured)) return { refused: 'outside-the-workspace' };

	const segments = configured
		.replace(/\\/g, '/')
		.split('/')
		.filter((segment) => segment !== '' && segment !== '.');

	if (segments.includes('..')) return { refused: 'outside-the-workspace' };

	return { segments };
}

/**
 * The path to store for a folder somebody picked, or `undefined` when it is not
 * inside the workspace folder at all. The same containment rule as above,
 * arriving from the other direction: a dialog will go anywhere on the machine.
 *
 * The workspace folder itself answers `''`, which is how a user gets back to the
 * default without editing settings by hand.
 */
export function relativeTo(root: string, chosen: string): string | undefined {
	const base = trimSlash(root);
	const target = trimSlash(chosen);

	if (target === base) return '';
	// The separator is required, or `/a/proj` would claim `/a/project`.
	if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
	return undefined;
}

const trimSlash = (path: string) => (path.endsWith('/') ? path.slice(0, -1) : path);
