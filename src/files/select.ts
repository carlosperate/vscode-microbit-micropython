/**
 * Which workspace files go onto the board. The device filesystem is flat, so
 * only the root is a candidate. Every rule below is enforced here because
 * `@microbit/microbit-fs` enforces none of them until hex generation, where it
 * throws bare `Error`s carrying no filename.
 */

/** The device's own limit, counted in bytes rather than characters. */
export const MAX_FILENAME_BYTES = 120;

export interface DirEntry {
	name: string;
	isDirectory: boolean;
}

/** Why a root entry did not make it onto the board. */
export type SkipReason = 'dotfile' | 'excluded' | 'name-too-long' | 'name-has-slash' | 'empty';

export interface Skipped {
	name: string;
	reason: SkipReason;
	/** Whether a user would be surprised, and so whether it is worth saying out loud. */
	notable: boolean;
}

export interface SelectedFile {
	name: string;
	data: Uint8Array;
}

export interface Selection {
	files: SelectedFile[];
	/** Root directories, named rather than listed: one line whatever they hold. */
	folders: string[];
	skipped: Skipped[];
}

/**
 * The workspace root, and a file directly inside it. There is no way to reach a
 * subfolder from here, which is the point: naming a folder costs nothing however
 * much it holds. `PromiseLike` because `workspace.fs` returns `Thenable`.
 */
type ReadDir = () => PromiseLike<DirEntry[]>;
type ReadFile = (name: string) => PromiseLike<Uint8Array>;

export async function selectFiles(
	readDir: ReadDir,
	readFile: ReadFile,
	exclude: readonly string[]
): Promise<Selection> {
	const files: SelectedFile[] = [];
	const folders: string[] = [];
	const skipped: Skipped[] = [];

	// By code unit, not `localeCompare`, whose order follows the host's locale:
	// two flashes of an unchanged workspace must produce identical bytes.
	const entries = [...(await readDir())].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	for (const entry of entries) {
		const { name } = entry;

		// The user's own instructions come first, and they rule out a folder as
		// readily as a file. Recorded rather than named: `.git` and `.vscode` are
		// in every real workspace, but somebody asking whether their exclude took
		// effect still has to be able to find the answer.
		const ruledOut = name.startsWith('.') ? 'dotfile' : isExcluded(name, exclude) ? 'excluded' : undefined;
		if (ruledOut) {
			skipped.push({ name, reason: ruledOut, notable: false });
			continue;
		}

		if (entry.isDirectory) {
			folders.push(name);
			continue;
		}

		const unusable = badName(name);
		if (unusable) {
			skipped.push({ name, reason: unusable, notable: true });
			continue;
		}

		const data = await readFile(name);
		if (data.length === 0) {
			// Nobody expects an empty `notes.txt` on a board; an empty `main.py` is
			// a learner wondering why nothing happened.
			skipped.push({ name, reason: 'empty', notable: name.endsWith('.py') });
			continue;
		}

		files.push({ name, data });
	}

	return { files, folders, skipped };
}

/** Names the device cannot hold, neither of which the library refuses. */
function badName(name: string): SkipReason | undefined {
	if (name.includes('/')) return 'name-has-slash';
	if (new TextEncoder().encode(name).length > MAX_FILENAME_BYTES) return 'name-too-long';
	return undefined;
}

const isExcluded = (name: string, exclude: readonly string[]) =>
	exclude.some((pattern) => matches(name, pattern));

/**
 * `*` and `?` over one filename. Escape everything first, which leaves the two
 * wildcards untouched because neither is in that set, then let them through.
 * A pattern spanning directories has nothing here to match, so no glob library.
 */
function matches(name: string, pattern: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]');
	return new RegExp(`^${expression}$`).test(name);
}
