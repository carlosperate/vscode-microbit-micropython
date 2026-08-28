/**
 * Selects direct project files for the board's flat filesystem. Invalid inputs
 * are rejected here because `microbit-fs` reports them late without filenames.
 */

/** The device's own limit, counted in bytes rather than characters. */
export const MAX_FILENAME_BYTES = 120;

export interface DirEntry {
	name: string;
	isDirectory: boolean;
}

/** Why a root entry did not make it onto the board. */
export type SkipReason = 'dotfile' | 'excluded' | 'build-output' | 'name-too-long' | 'name-has-slash' | 'empty';

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

/** Readers cannot enter subfolders; `PromiseLike` accepts VS Code's `Thenable`. */
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

	// Code-unit order is deterministic across host locales.
	const entries = [...(await readDir())].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	for (const entry of entries) {
		const { name } = entry;

		// Dotfiles and configured exclusions remain recorded for diagnostics.
		const ruledOut = name.startsWith('.') ? 'dotfile' : isExcluded(name, exclude) ? 'excluded' : undefined;
		if (ruledOut) {
			skipped.push({ name, reason: ruledOut, notable: false });
			continue;
		}

		if (entry.isDirectory) {
			folders.push(name);
			continue;
		}

		// Build outputs cannot fit on the device and FAT may return their names uppercased.
		if (name.toLowerCase().endsWith('.hex')) {
			skipped.push({ name, reason: 'build-output', notable: false });
			continue;
		}

		const unusable = badName(name);
		if (unusable) {
			skipped.push({ name, reason: unusable, notable: true });
			continue;
		}

		const data = await readFile(name);
		if (data.length === 0) {
			// An empty Python file can otherwise look like a successful program that does nothing.
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

/** Matches `*` and `?` over one filename; directories are never candidates. */
function matches(name: string, pattern: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]');
	return new RegExp(`^${expression}$`).test(name);
}
