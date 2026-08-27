/**
 * The MicroPython images this extension ships, and turning them plus a set of
 * workspace files into a hex a micro:bit can run.
 *
 * Which images a filesystem is built from is the caller's decision and it
 * decides everything else: capacity is a property of the instance, so a build
 * for one known board reports that board's room and a build for an unknown
 * target reports what every board can hold. Nothing here works a size out.
 */
import { MicropythonFsHex, microbitBoardId } from '@microbit/microbit-fs';

import manifest from '../../assets/firmware/firmware.json';
import { type SelectedFile } from '../files/select';

/** The micro:bit hardware revisions there is a MicroPython image for. */
export type BoardVersion = 'V1' | 'V2';

/** An image, the board it runs on, and the file it came out of. */
export interface Firmware {
	/** Named in every failure: it is the one thing a user can go and look at. */
	file: string;
	hex: string;
	boardId: microbitBoardId;
}

/** Reads one image from wherever they are kept, by name. */
export type ReadImage = (file: string) => PromiseLike<Uint8Array>;

/** A hex, and what it costs on the device. */
export interface Built {
	hex: string;
	used: number;
	available: number;
}

/**
 * An image is unreadable, incomplete, or is not the one asked for. Everything it
 * covers means the installation is damaged rather than the workspace.
 */
export class FirmwareError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FirmwareError';
	}
}

/** The files are past what the device filesystem can hold. */
export class StorageFullError extends Error {
	constructor(
		readonly used: number,
		readonly available: number,
		message: string
	) {
		super(message);
		this.name = 'StorageFullError';
	}
}

const IMAGES: Record<BoardVersion, { file: string; boardId: microbitBoardId }> = {
	V1: { file: manifest.v1.file, boardId: microbitBoardId.V1 },
	V2: { file: manifest.v2.file, boardId: microbitBoardId.V2 },
};

/** Every board there is an image for, derived so adding one reaches every build. */
const BOARDS = Object.keys(IMAGES) as BoardVersion[];

/** The images ship in the VSIX, so anything wrong with one is an install away. */
const REINSTALL = 'Reinstalling the extension should restore it.';

/**
 * Reads each image at most once. Every image is over half a megabyte and a
 * session usually needs only one of them, so nothing is read until a build asks
 * for that board.
 */
export function createFirmwareCache(read: ReadImage): (version: BoardVersion) => Promise<Firmware> {
	// Holds the in-flight promise, not the result, so two builds started together
	// share one read. A rejected read is dropped again, or a blip during the
	// first build would poison the whole session.
	const loading = new Map<BoardVersion, Promise<Firmware>>();

	return (version) => {
		let pending = loading.get(version);
		if (!pending) {
			pending = readImage(read, version);
			loading.set(version, pending);
			pending.catch(() => loading.delete(version));
		}
		return pending;
	};
}

async function readImage(read: ReadImage, version: BoardVersion): Promise<Firmware> {
	const { file, boardId } = IMAGES[version];

	let bytes: Uint8Array;
	try {
		bytes = await read(file);
	} catch {
		// The reason stays with the reader that has it: a `FileSystemError` keeps
		// its own name inside `message`, which reads as
		// "(Unknown (FileSystemError): Not Found)" mid-sentence.
		throw new FirmwareError(`Could not read the MicroPython firmware image ${file}. ${REINSTALL}`);
	}

	const hex = new TextDecoder().decode(bytes);
	// Intel hex is `:` records ending in an end-of-file one. Checked before the
	// library sees an anonymous string and reports a parse failure naming
	// nothing, and it catches the read that succeeded and returned the wrong
	// thing: a web host answers a missing file with an error page and a 200.
	if (!hex.startsWith(':') || !hex.trimEnd().endsWith(':00000001FF')) {
		throw new FirmwareError(`The MicroPython firmware image ${file} is damaged or incomplete. ${REINSTALL}`);
	}

	return { file, hex, boardId };
}

/**
 * A filesystem holding `files`, built on the images given and no others.
 *
 * Every rule about which files may be here was applied before this point: the
 * library accepts an over-long name, a name with a slash and a payload past
 * capacity without complaint, and rejects an empty file with a bare throw.
 */
export function buildFs(images: readonly Firmware[], files: readonly SelectedFile[]): MicropythonFsHex {
	let fs: MicropythonFsHex;
	try {
		fs = new MicropythonFsHex([...images]);
	} catch {
		const named = images.map((image) => image.file).join(' and ');
		throw new FirmwareError(`${named} could not be read as MicroPython. ${REINSTALL}`);
	}

	for (const file of files) fs.write(file.name, file.data);
	return fs;
}

/**
 * The hex itself: for one board when its id is known, and one that runs on
 * every board this extension has an image for when it is not.
 *
 * The size check has to live here because `microbit-fs` takes files well past
 * capacity without complaint and only refuses at this last step, and refusing
 * before generating saves assembling a megabyte of hex to throw away.
 */
export function generateHex(fs: MicropythonFsHex, boardId?: microbitBoardId): Built {
	const used = fs.getStorageUsed();
	const available = fs.getStorageSize();
	if (fs.getStorageRemaining() < 0) throw tooBig(used, available, boardId);

	try {
		const hex = boardId === undefined ? fs.getUniversalHex() : fs.getIntelHex(boardId);
		return { hex, used, available };
	} catch (error) {
		// The library's own guards are bare `Error`s with no code and no numbers,
		// so the message is all there is to recognise them by. It answers with two
		// different ones for a full filesystem, depending on whether any chunk was
		// free at all when it started.
		const reason = String(error);
		if (/storage space|enough space/i.test(reason)) throw tooBig(used, available, boardId);
		if (/board id requested not found/i.test(reason)) {
			throw new FirmwareError(
				`There is no MicroPython image for this micro:bit (board id 0x${boardId?.toString(16)}). ` +
					'It may be a newer board than this extension knows about.'
			);
		}
		throw error;
	}
}

/**
 * A hex for one board when its version is known, and one that runs on every
 * board there is an image for when it is not. Only what the target needs is
 * read, so a flash to a V2 never touches the V1 image or its half a megabyte.
 */
export async function buildFor(
	read: (version: BoardVersion) => PromiseLike<Firmware>,
	board: BoardVersion | undefined,
	files: readonly SelectedFile[]
): Promise<Built> {
	if (board) {
		const image = await read(board);
		return generateHex(buildFs([image], files), image.boardId);
	}

	// Called with the version alone: passing `read` to `map` would hand it the
	// index and the array as well, which a reader is free to have parameters for.
	const images = await Promise.all(BOARDS.map((version) => read(version)));
	return generateHex(buildFs(images, files));
}

/** The sentence says which of the two builds the figures are about. */
function tooBig(used: number, available: number, boardId: microbitBoardId | undefined): StorageFullError {
	const room =
		boardId === undefined ? 'a hex that runs on every micro:bit has room for' : 'this micro:bit has room for';

	return new StorageFullError(
		used,
		available,
		`These files need ${used} bytes of micro:bit storage, and ${room} ${available}. ` +
			'Remove or shorten a file and try again.'
	);
}
