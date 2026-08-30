/**
 * Finding the drive a micro:bit mounts, the only way to program one where no USB
 * device can be authorised. Nothing on a drive is opened before its name has
 * matched: walking the drive letters instead contacts every mapped network drive
 * and waits out each dead one.
 */
import type { BoardVersion } from '../hex/build';
import { boardVersion } from './details';

/** Injected so the search runs off a real machine. */
export interface DriveIo {
	list(path: string): Promise<string[]>;
	read(path: string): Promise<string>;
	/** Asked only on Windows, where a path carries no volume name. */
	removableVolumes(): Promise<Volume[]>;
}

export interface Volume {
	name: string;
	/** A drive letter and its colon on Windows. */
	path: string;
}

export interface Machine {
	platform: string;
	/** Part of the mount path on Linux. Empty if unknown. */
	user: string;
}

export interface Board {
	path: string;
	/** Unknown builds a hex for every board rather than guessing. */
	version: BoardVersion | undefined;
}

const DETAILS = 'DETAILS.TXT';

/** Some builds omit DETAILS.TXT, so this is the second chance at a board. */
const LANDING_PAGE = 'MICROBIT.HTM';

/** DAPLink names the volume after the board, and every system numbers a second one. */
const VOLUME_NAME = /^MICROBIT[ _-]?\d*$/i;

/**
 * `configured` is a mount point named by the user, still checked for a board
 * rather than written to on trust. Rejects only where a platform will not say
 * what is mounted; nothing mounted is an empty list.
 */
export async function findBoards(io: DriveIo, machine: Machine, configured?: string): Promise<Board[]> {
	const paths = configured ? [configured] : await candidates(io, machine);
	const found = await Promise.all(paths.map((path) => identify(io, path, machine.platform)));
	return found.filter((board): board is Board => board !== undefined);
}

async function candidates(io: DriveIo, { platform, user }: Machine): Promise<string[]> {
	// Not caught: a refusal to say what is mounted is not the same as no board.
	if (platform === 'win32') {
		const volumes = await io.removableVolumes();
		return volumes.filter((volume) => VOLUME_NAME.test(volume.name)).map((volume) => volume.path);
	}

	const paths: string[] = [];
	for (const parent of mountParents(platform, user)) {
		// Most machines have only one of these.
		const names = await io.list(parent).catch(() => []);
		for (const name of names) if (VOLUME_NAME.test(name)) paths.push(`${parent}/${name}`);
	}
	return paths;
}

const mountParents = (platform: string, user: string): string[] =>
	platform === 'darwin'
		? ['/Volumes']
		: [...(user ? [`/media/${user}`, `/run/media/${user}`] : []), '/media', '/mnt'];

/** The name matched, so what is left is which board, and whether it is one at all. */
async function identify(io: DriveIo, path: string, platform: string): Promise<Board | undefined> {
	const read = (name: string) => io.read(join(platform, path, name)).catch(() => undefined);

	// First, because it answers both at once.
	const details = await read(DETAILS);
	if (details !== undefined) return { path, version: boardVersion(details) };

	return (await read(LANDING_PAGE)) === undefined ? undefined : { path, version: undefined };
}

const join = (platform: string, dir: string, name: string) => `${dir}${platform === 'win32' ? '\\' : '/'}${name}`;
