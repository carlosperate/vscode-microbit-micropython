/** The real filesystem behind the drive search, and where this machine mounts one. */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';

import type { DriveIo, Machine, Volume } from '../drive/volume';

const run = promisify(execFile);

/** A wedged storage service must report no board, not hang Flash forever. */
const VOLUME_QUERY_MS = 10_000;

/** `Win32_Volume` is local volumes only, so a network drive is never contacted. */
const VOLUME_QUERY =
	"Get-CimInstance -ClassName Win32_Volume -Filter 'DriveType=2' | " +
	'Select-Object DriveLetter,Label | ConvertTo-Json -Compress';

/**
 * Absolute, because `CreateProcess` searches the calling application's directory
 * and the working directory before the system one. A bare name would let a
 * `powershell.exe` sitting in the open project run instead of the real one.
 */
const POWERSHELL = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

/** `note` is injected rather than imported, so nothing here reaches for `vscode`. */
export function createDriveIo(note: (message: string) => void): DriveIo {
	/**
	 * The search treats every failed read as "not a board", which is right for the
	 * missing paths that are most of them. A permission or I/O error would vanish
	 * the same way, so it is written down on its way past.
	 */
	const noted = <T>(path: string, work: Promise<T>): Promise<T> =>
		work.catch((error: unknown) => {
			const { code } = (error ?? {}) as { code?: string };
			if (code !== 'ENOENT' && code !== 'ENOTDIR') note(`Could not read ${path}: ${String(error)}`);
			throw error;
		});

	return {
		list: (path) => noted(path, readdir(path)),
		// latin1 never throws, so a decode cannot hide a board.
		read: (path) => noted(path, readFile(path, 'latin1')),
		removableVolumes,
	};
}

async function removableVolumes(): Promise<Volume[]> {
	const { stdout } = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', VOLUME_QUERY], {
		timeout: VOLUME_QUERY_MS,
		windowsHide: true,
	});
	return parseVolumes(stdout);
}

/** One row is a bare object, several an array, none no output at all. */
export function parseVolumes(stdout: string): Volume[] {
	const parsed: unknown = JSON.parse(stdout.trim() || '[]');
	const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

	return rows.flatMap((row) => {
		const { DriveLetter, Label } = (row ?? {}) as { DriveLetter?: unknown; Label?: unknown };
		// A volume mounted into a folder has no letter and nowhere to copy to.
		if (typeof DriveLetter !== 'string' || !DriveLetter) return [];
		return [{ name: typeof Label === 'string' ? Label : '', path: DriveLetter }];
	});
}

export const machine = (): Machine => ({ platform: process.platform, user: username() });

/** Throws where the account has no passwd entry; the shared mount points still work. */
function username(): string {
	try {
		return userInfo().username;
	} catch {
		return process.env.USER ?? process.env.USERNAME ?? '';
	}
}
