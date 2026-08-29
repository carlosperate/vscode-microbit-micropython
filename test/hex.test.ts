/**
 * Hex building, run against the real committed images rather than a synthetic
 * MicroPython hex. Hand-building one would mean writing the library's own UICR
 * layout, page sizes and region table into this file, which is a second copy of
 * exactly the knowledge these tests exist to keep out of the repository. Parsing
 * a real image costs about 150 ms and that is the whole price.
 */
import { microbitBoardId, type MicropythonFsHex } from '@microbit/microbit-fs';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { type SelectedFile } from '../src/files/select';
import {
	buildFor,
	buildFs,
	createFirmwareCache,
	FirmwareError,
	generateHex,
	StorageFullError,
	type BoardVersion,
	type Firmware,
} from '../src/hex/build';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, '..', 'src');
const imageDir = path.join(here, '..', 'assets', 'firmware');
const imageBytes = (file: string) => readFile(path.join(imageDir, file));

// One read of each image for the whole file. Decoding 1.9 MB of text is the
// cheap half; every test still builds its own filesystem, which is the slow one.
const firmware = createFirmwareCache(imageBytes);
const v1 = () => firmware('V1');
const v2 = () => firmware('V2');

const encode = (text: string) => new TextEncoder().encode(text);
const file = (name: string, data: string | Uint8Array): SelectedFile => ({
	name,
	data: typeof data === 'string' ? encode(data) : data,
});

const PROGRAM = file('main.py', 'from microbit import *\ndisplay.scroll("hi")\n');

describe('the filesystem built from a workspace', () => {
	it('gives back every file it was handed, byte for byte', async () => {
		// Deliberately not valid UTF-8: the device filesystem holds any file, and
		// a text round trip through the library would corrupt this one silently.
		const binary = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x80, 0x41]);
		const fs = buildFs([await v2()], [PROGRAM, file('blob.dat', binary)]);

		expect(fs.ls().sort()).toEqual(['blob.dat', 'main.py']);
		expect(fs.readBytes('blob.dat')).toEqual(binary);
		expect(fs.readBytes('main.py')).toEqual(PROGRAM.data);
	});
});

describe('choosing a hex for a target', () => {
	it('gives one board its own hex, and an unknown target a hex for both', async () => {
		const fs = buildFs([await v1(), await v2()], [PROGRAM]);

		const forV2 = generateHex(fs, microbitBoardId.V2).hex;
		const forEither = generateHex(fs).hex;

		expect(forV2.startsWith(':')).toBe(true);
		// A universal hex is the two board hexes with a block header on each
		// record, so it lands within a few hundred bytes of their sum.
		const both = generateHex(fs, microbitBoardId.V1).hex.length + forV2.length;
		expect(forEither.length).toBeGreaterThan(both * 0.9);
		expect(forEither.length).toBeLessThan(both * 1.1);
	});

	it('says so when it holds no image for the board asked for', async () => {
		const fs = buildFs([await v2()], [PROGRAM]);

		// Reachable whenever a board version and the images loaded for it
		// disagree, and the library's own answer is a bare "Board ID requested
		// not found." with nothing in it a user could act on.
		expect(() => generateHex(fs, microbitBoardId.V1)).toThrow(FirmwareError);
		expect(() => generateHex(fs, microbitBoardId.V1)).toThrow(/micro:bit/);
	});
});

/**
 * A flash knows which board answered, so it builds from that board's image
 * alone. Reading the other one costs half a megabyte of parsing for a hex that
 * would then be twice the size it needs to be.
 */
describe('building for the board that is there', () => {
	const reads = () => vi.fn<(version: BoardVersion) => Promise<Firmware>>(firmware);

	it('reads one image for a known board, and only that one', async () => {
		const read = reads();
		const built = await buildFor(read, 'V2', [PROGRAM]);

		expect(read.mock.calls.flat()).toEqual(['V2']);
		expect(built.hex.startsWith(':')).toBe(true);
	});

	it('reads every image when the board is unknown', async () => {
		const read = reads();
		await buildFor(read, undefined, [PROGRAM]);

		expect(read.mock.calls.flat().sort()).toEqual(['V1', 'V2']);
	});

	/** The hex a board gets has to be the one its own id opens, or it runs nothing. */
	it('gives each board a hex its own id opens', async () => {
		const forV1 = await buildFor(firmware, 'V1', [PROGRAM]);
		const forV2 = await buildFor(firmware, 'V2', [PROGRAM]);
		const forEither = await buildFor(firmware, undefined, [PROGRAM]);

		expect(forV1.hex).not.toBe(forV2.hex);
		// A universal hex opens each board's block with that id followed by C0DE.
		// Asserted present there first, or the absences below would pass on a
		// sentinel that had changed shape and stopped meaning anything.
		for (const id of [microbitBoardId.V1, microbitBoardId.V2]) {
			const marker = `${id.toString(16)}C0DE`;
			expect(forEither.hex).toContain(marker);
			expect(forV1.hex).not.toContain(marker);
			expect(forV2.hex).not.toContain(marker);
		}
	});

	/** Half the room of a universal build, and it is the library's figure either way. */
	it('reports the room on that board rather than on the smallest', async () => {
		const forV2 = await buildFor(firmware, 'V2', [PROGRAM]);
		const forEither = await buildFor(firmware, undefined, [PROGRAM]);

		expect(forV2.available).toBeGreaterThanOrEqual(forEither.available);
	});
});

describe('capacity', () => {
	/**
	 * Fills the filesystem exactly to the brim and returns the payload size that
	 * did it, found by asking the filesystem rather than by repeating its chunk
	 * arithmetic here.
	 */
	const fillToTheBrim = (fs: MicropythonFsHex): number => {
		for (let size = fs.getStorageSize(); size > 0; size--) {
			fs.write(PROGRAM.name, new Uint8Array(size));
			if (fs.getStorageRemaining() >= 0) return size;
		}
		throw new Error('this filesystem has no room for a file at all');
	};

	it('takes the largest payload the filesystem reports, and refuses one byte more', async () => {
		const fs = buildFs([await v2()], []);
		const largest = fillToTheBrim(fs);

		expect(() => generateHex(fs, microbitBoardId.V2)).not.toThrow();

		fs.write(PROGRAM.name, new Uint8Array(largest + 1));
		expect(() => generateHex(fs, microbitBoardId.V2)).toThrow(StorageFullError);
	});

	it('refuses with both numbers in it, taken from the filesystem itself', async () => {
		const fs = buildFs([await v2()], []);
		fs.write(PROGRAM.name, new Uint8Array(fs.getStorageSize() + 1));
		// Refused before a megabyte of hex is assembled to be thrown away.
		const generate = vi.spyOn(fs, 'getIntelHex');

		let refusal: StorageFullError | undefined;
		try {
			generateHex(fs, microbitBoardId.V2);
		} catch (error) {
			refusal = error as StorageFullError;
		}

		expect(generate).not.toHaveBeenCalled();

		// Storage is handed out in whole chunks, so neither figure is the sum of
		// the file lengths and both have to come off the instance.
		expect(refusal?.used).toBe(fs.getStorageUsed());
		expect(refusal?.available).toBe(fs.getStorageSize());
		expect(refusal?.message).toContain(String(fs.getStorageUsed()));
		expect(refusal?.message).toContain(String(fs.getStorageSize()));
	});

	it('translates the library refusal that follows if the check is ever wrong', async () => {
		const fs = buildFs([await v2()], []);
		fs.write(PROGRAM.name, new Uint8Array(fs.getStorageSize()));
		// The only way to reach the library's own enforcement, which answers with
		// a bare Error carrying no numbers and no code.
		vi.spyOn(fs, 'getStorageRemaining').mockReturnValue(0);

		const refuse = () => generateHex(fs, microbitBoardId.V2);
		expect(refuse).toThrow(StorageFullError);
		expect(refuse).toThrow(String(fs.getStorageSize()));
	});
});

describe('reading the images', () => {
	it('reads an image once a session, and never the one it was not asked for', async () => {
		const read = vi.fn(imageBytes);
		const cache = createFirmwareCache(read);

		const [first, second] = await Promise.all([cache('V2'), cache('V2')]);
		await cache('V2');

		expect(read).toHaveBeenCalledTimes(1);
		expect(read.mock.calls[0][0]).toContain('v2');
		expect(first).toBe(second);
	});

	it('does not remember a failed read, so the next attempt is a real one', async () => {
		const read = vi.fn(imageBytes);
		const cache = createFirmwareCache(read);

		read.mockRejectedValueOnce(new Error('404'));
		await expect(cache('V2')).rejects.toThrow(FirmwareError);

		await expect(cache('V2')).resolves.toHaveProperty('boardId', microbitBoardId.V2);
	});

	it('names the image when what comes back is not a whole Intel hex', async () => {
		const cache = createFirmwareCache(async (file) =>
			encode((await imageBytes(file)).toString('utf8').split('\n').slice(0, 100).join('\n'))
		);

		await expect(cache('V2')).rejects.toThrow(/micropython-microbit-v2/);
	});

	it('names the image when the read returns an error page instead', async () => {
		const cache = createFirmwareCache(async () => encode('<!DOCTYPE html><title>404</title>'));

		await expect(cache('V1')).rejects.toThrow(/micropython-microbit-v1/);
	});
});

describe('the size of the device filesystem', () => {
	/**
	 * Capacity belongs to `microbit-fs`: it falls out of the pinned firmware's
	 * flash layout and moves the next time an image is bumped. A figure of that
	 * scale written into our source is a copy nothing will ever update, so this
	 * refuses one anywhere in `src/`, in a constant, a comment or a message.
	 *
	 * A number that is legitimately this big goes in here with the reason it is
	 * not a capacity, which keeps every one of them a deliberate decision.
	 */
	const ALLOWED = new Map<number, string>([
		[0x0d28, "the micro:bit's USB vendor id, which is the library's own device filter and not a size"],
		[1500, 'milliseconds spent waiting for the USB bus to settle after a board disappears'],
		[2000, 'milliseconds a hold waits for terminal input already accepted to reach the board'],
		[115200, "the micro:bit's serial baud rate"],
	]);

	/** Device figures start at one filesystem chunk and run to whole flash pages. */
	const CHUNK_SIZE = 128;
	const SMALLEST_PAGE = 1024;
	const isDeviceScale = (value: number) => value === CHUNK_SIZE || value >= SMALLEST_PAGE;

	const NUMBER = /\b(?:0[xX][0-9a-fA-F][0-9a-fA-F_]*|\d[\d_]*)\b/g;

	it('is never written into src/', () => {
		const found: string[] = [];

		for (const name of readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })) {
			if (!name.endsWith('.ts')) continue;
			const source = readFileSync(path.join(sourceDir, name), 'utf8');
			for (const [literal] of source.matchAll(NUMBER)) {
				const value = Number(literal.replace(/_/g, ''));
				if (!isDeviceScale(value) || ALLOWED.has(value)) continue;
				found.push(`src/${name}: ${literal}`);
			}
		}

		expect(found, 'ask the MicropythonFsHex instance for these instead').toEqual([]);
	});
});
