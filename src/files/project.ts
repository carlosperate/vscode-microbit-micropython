/** Normalises configured and selected project folders without depending on VS Code. */

/** Why a configured value cannot be used. The wording belongs to the caller. */
export type Refusal = 'not-a-string' | 'outside-the-workspace';

/**
 * The segments below the workspace folder, empty for the folder itself, or the
 * reason there are none. A value rather than a thrown error, so the pure core
 * carries no message strings and the adapter decides what a user reads.
 */
export type ProjectPath = { segments: string[] } | { refused: Refusal };

/** The full URI scheme grammar also catches Windows drives and schemes with punctuation. */
const ROOTED = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalises a configured path relative to its workspace folder. Traversal is
 * rejected before `Uri.joinPath`, which otherwise resolves `..` outside the root.
 */
export function projectPath(configured: unknown): ProjectPath {
	// Absent means the workspace folder, which is the default and the common case.
	if (configured === undefined) return { segments: [] };

	// Manifest setting types do not validate values read from hand-edited JSON.
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
 * Converts a picked folder to a stored relative path, refusing anything outside
 * the workspace. The workspace folder itself returns the empty default.
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
