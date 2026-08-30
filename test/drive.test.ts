/**
 * Finding a micro:bit's mounted drive, against a fake filesystem. The real one
 * is a board plugged into somebody's machine, so every path below is the shape
 * an operating system puts a removable volume at rather than one that exists.
 */
import { describe, expect, it } from 'vitest';

import { boardVersion } from '../src/drive/details';
import { findBoards, type DriveIo, type Machine, type Volume } from '../src/drive/volume';
import { createDriveIo, machine, parseVolumes } from '../src/node/io';

/** A real V1 file, `Board ID` absent, as DAPLink 0234 writes it. */
const V1_DETAILS = [
	'# DAPLink Firmware - see https://mbed.com/daplink',
	'Unique ID: 9900023419055e6500000000000000000000000097969901',
	'HIC ID: 97969901',
	'Auto Reset: 0',
	'Automation allowed: 0',
	'Daplink Mode: Interface',
	'Interface Version: 0234',
	'Git SHA: b403a07e3ea9d4c33dfe7f4c30e6d4a1c3a1c1b1',
	'Local Mods: 0',
	'USB Interfaces: MSD, CDC, HID',
	'Interface CRC: 0x26e0f6bd',
	'',
].join('\n');

/** A real V2 file, which does carry `Board ID`, and a `9903` unique id agreeing with it. */
const V2_DETAILS = [
	'# DAPLink Firmware - see https://daplink.io',
	'Unique ID: 9903360247474e450038500a00000024000000009796990b',
	'HIC ID: 97969903',
	'Auto Reset: 1',
	'Automation allowed: 0',
	'Overflow detection: 1',
	'Daplink Mode: Interface',
	'Interface Version: 0255',
	'Bootloader Version: 0255',
	'Git SHA: 4d0d0a0f4f5f7c9d8e1b0a2c3d4e5f60718293a4',
	'Local Mods: 0',
	'USB Interfaces: MSD, CDC, HID, WebUSB',
	'Board ID: 9903',
	'Remount count: 0',
	'URL: https://microbit.org/device/?id=9903&v=0255',
	'',
].join('\n');

describe('reading DETAILS.TXT', () => {
	it('recognises a V1 from its unique id alone', () => {
		expect(boardVersion(V1_DETAILS)).toBe('V1');
	});

	it('recognises a V2', () => {
		expect(boardVersion(V2_DETAILS)).toBe('V2');
	});

	/** A file cut short mid-write is what a drive pulled out during a read leaves. */
	it('gives no answer for a file that stops before the id', () => {
		expect(boardVersion('# DAPLink Firmware - see https://daplink.io\nUniq')).toBeUndefined();
		expect(boardVersion('')).toBeUndefined();
	});

	/**
	 * The list of ids grows with each hardware revision, and a board newer than
	 * this extension has to fall back to a hex for every board. Guessing V2 from
	 * "not a V1 id" would flash the wrong firmware onto whatever comes next.
	 */
	it('gives no answer for an id it does not know', () => {
		expect(boardVersion(V2_DETAILS.replace(/9903/g, '9999'))).toBeUndefined();
	});

	/** DAPLink writes CRLF, so an anchored line pattern has to survive the carriage returns. */
	it('reads a file with CRLF line endings', () => {
		expect(boardVersion(V1_DETAILS.replace(/\n/g, '\r\n'))).toBe('V1');
		expect(boardVersion(V2_DETAILS.replace(/\n/g, '\r\n'))).toBe('V2');
	});

	/** Every id in circulation, so a table edited by hand cannot lose one silently. */
	it.each([
		['9900', 'V1'],
		['9901', 'V1'],
		['9903', 'V2'],
		['9904', 'V2'],
		['9905', 'V2'],
		['9906', 'V2'],
	])('reads board id %s as a %s', (id, version) => {
		expect(boardVersion(`Unique ID: ${id}0000000000000000000000000000000000000000`)).toBe(version);
	});
});

/**
 * What `ConvertTo-Json` hands back, which changes shape with the number of rows
 * and is the one part of the Windows query that can be tested off Windows.
 */
describe('reading the Windows volume list', () => {
	it('takes the bare object one volume produces', () => {
		expect(parseVolumes('{"DriveLetter":"E:","Label":"MICROBIT"}')).toEqual([{ name: 'MICROBIT', path: 'E:' }]);
	});

	it('takes the array several produce', () => {
		expect(
			parseVolumes('[{"DriveLetter":"E:","Label":"MICROBIT"},{"DriveLetter":"F:","Label":"Backups"}]')
		).toEqual([
			{ name: 'MICROBIT', path: 'E:' },
			{ name: 'Backups', path: 'F:' },
		]);
	});

	/** No removable drives at all writes nothing, which is not JSON. */
	it('takes the empty output none produces', () => {
		expect(parseVolumes('')).toEqual([]);
		expect(parseVolumes('\r\n')).toEqual([]);
	});

	/** A volume mounted into a folder has no letter, so there is nowhere to copy to. */
	it('drops a volume with no drive letter', () => {
		expect(parseVolumes('[{"DriveLetter":null,"Label":"MICROBIT"}]')).toEqual([]);
	});

	/** An unformatted or unlabelled volume answers null, and must not become "null". */
	it('reads a missing label as an empty name', () => {
		expect(parseVolumes('{"DriveLetter":"E:","Label":null}')).toEqual([{ name: '', path: 'E:' }]);
	});

	/**
	 * The query itself, which a fake cannot cover: whether `powershell.exe` is
	 * where it is expected, whether `Win32_Volume` answers at all, and whether
	 * what it prints is what the parser above was written against. Runs only on
	 * Windows, since there is no WMI to ask anywhere else, so **CI's windows leg
	 * is the only thing that ever checks this**.
	 */
	it.runIf(process.platform === 'win32')(
		'asks real Windows for its removable volumes',
		async () => {
			const volumes = await realIo.removableVolumes();
			// A runner with no removable drive answers with none, which is a pass:
			// what is under test is that it answered.
			for (const volume of volumes) expect(volume.path).toMatch(/^[A-Za-z]:$/);
		},
		VOLUME_QUERY_TIMEOUT_MS
	);
});

/** The query's own cap plus room for a cold PowerShell start on a loaded runner. */
const VOLUME_QUERY_TIMEOUT_MS = 30_000;

/** The real one. Its notes go nowhere here: the output channel needs an editor. */
const realIo = createDriveIo(() => undefined);

/**
 * The real filesystem on whatever this machine is. Every other test here runs
 * against a fake, so this is the only one that exercises the platform branch the
 * developer is not sitting on, and CI runs it on Windows, macOS and Linux.
 */
describe('searching this machine', () => {
	it('answers without throwing, whatever is plugged in', async () => {
		const boards = await findBoards(realIo, machine());

		// A runner has no board, which is a pass: under test is that the real mount
		// parents, or the real Windows query, can be asked at all.
		for (const board of boards) {
			expect(board.path).toBeTruthy();
			expect(['V1', 'V2', undefined]).toContain(board.version);
		}
	}, VOLUME_QUERY_TIMEOUT_MS);

	it('reports this platform, and a name it may not have', () => {
		expect(machine().platform).toBe(process.platform);
		expect(typeof machine().user).toBe('string');
	});
});

/**
 * A filesystem of exactly the files named, and nothing else readable. `opened`
 * records every path read, because which drives are *not* touched is half of
 * what this module is for.
 */
function fakeIo(
	tree: Record<string, string[]>,
	files: Record<string, string>,
	volumes: Volume[] = []
): DriveIo & { opened: string[] } {
	const opened: string[] = [];
	return {
		opened,
		list: async (path) => tree[path] ?? Promise.reject(new Error(`ENOENT ${path}`)),
		read: async (path) => {
			opened.push(path);
			return files[path] ?? Promise.reject(new Error(`ENOENT ${path}`));
		},
		removableVolumes: async () => volumes,
	};
}

const mac: Machine = { platform: 'darwin', user: 'someone' };
const linux: Machine = { platform: 'linux', user: 'someone' };
const windows: Machine = { platform: 'win32', user: 'someone' };

describe('finding a mounted micro:bit', () => {
	it('finds the board macOS mounted, and says which one it is', async () => {
		const io = fakeIo({ '/Volumes': ['Macintosh HD', 'MICROBIT'] }, { '/Volumes/MICROBIT/DETAILS.TXT': V2_DETAILS });

		expect(await findBoards(io, mac)).toEqual([{ path: '/Volumes/MICROBIT', version: 'V2' }]);
	});

	/**
	 * The first candidate directory is the one most machines do not have, so a
	 * search that stopped at a missing mount parent would find nothing on the
	 * distributions that use the other one.
	 */
	it('keeps looking past a mount parent that is not there', async () => {
		const io = fakeIo(
			{ '/run/media/someone': ['MICROBIT'] },
			{ '/run/media/someone/MICROBIT/DETAILS.TXT': V1_DETAILS }
		);

		expect(await findBoards(io, linux)).toEqual([{ path: '/run/media/someone/MICROBIT', version: 'V1' }]);
	});

	it('finds nothing when no board is plugged in', async () => {
		expect(await findBoards(fakeIo({ '/Volumes': ['Macintosh HD'] }, {}), mac)).toEqual([]);
		expect(await findBoards(fakeIo({}, {}), linux)).toEqual([]);
		expect(await findBoards(fakeIo({}, {}), windows)).toEqual([]);
	});

	/**
	 * The failure this whole module is shaped around: somebody's USB stick, named
	 * MICROBIT by hand or by a previous life as a board, holding files a hex would
	 * be written alongside.
	 */
	it('refuses a volume that is named MICROBIT and is not one', async () => {
		const io = fakeIo({ '/Volumes': ['MICROBIT'] }, { '/Volumes/MICROBIT/holiday-photos.zip': 'not a board' });

		expect(await findBoards(io, mac)).toEqual([]);
	});

	/** A board whose details cannot be read still flashes, from a hex for every board. */
	it('takes a board that has no readable DETAILS.TXT', async () => {
		const io = fakeIo({ '/Volumes': ['MICROBIT'] }, { '/Volumes/MICROBIT/MICROBIT.HTM': '<html></html>' });

		expect(await findBoards(io, mac)).toEqual([{ path: '/Volumes/MICROBIT', version: undefined }]);
	});

	it('reads a truncated DETAILS.TXT as a board of unknown version', async () => {
		const io = fakeIo({ '/Volumes': ['MICROBIT'] }, { '/Volumes/MICROBIT/DETAILS.TXT': '' });

		expect(await findBoards(io, mac)).toEqual([{ path: '/Volumes/MICROBIT', version: undefined }]);
	});

	/** Classrooms have more than one board on a machine, and both have to be offered. */
	it('finds every board, however the second one was named', async () => {
		const io = fakeIo(
			{ '/Volumes': ['MICROBIT', 'MICROBIT 1'] },
			{
				'/Volumes/MICROBIT/DETAILS.TXT': V1_DETAILS,
				'/Volumes/MICROBIT 1/DETAILS.TXT': V2_DETAILS,
			}
		);

		expect(await findBoards(io, mac)).toEqual([
			{ path: '/Volumes/MICROBIT', version: 'V1' },
			{ path: '/Volumes/MICROBIT 1', version: 'V2' },
		]);
	});

	it('takes the numbered second volume Linux mounts', async () => {
		const io = fakeIo(
			{ '/media/someone': ['MICROBIT', 'MICROBIT1'] },
			{
				'/media/someone/MICROBIT/DETAILS.TXT': V1_DETAILS,
				'/media/someone/MICROBIT1/DETAILS.TXT': V1_DETAILS,
			}
		);

		expect((await findBoards(io, linux)).map((board) => board.path)).toEqual([
			'/media/someone/MICROBIT',
			'/media/someone/MICROBIT1',
		]);
	});

	/** No `/media/<user>` to look in, and the shared mount points still have to be searched. */
	it('searches on without an account name', async () => {
		const io = fakeIo({ '/media': ['MICROBIT'] }, { '/media/MICROBIT/DETAILS.TXT': V2_DETAILS });

		expect(await findBoards(io, { platform: 'linux', user: '' })).toEqual([
			{ path: '/media/MICROBIT', version: 'V2' },
		]);
	});

	/** Windows carries no volume name in the path, so the system is asked for them. */
	it('takes the Windows volume the system named MICROBIT', async () => {
		const io = fakeIo({}, { 'E:\\DETAILS.TXT': V2_DETAILS }, [{ name: 'MICROBIT', path: 'E:' }]);

		expect(await findBoards(io, windows)).toEqual([{ path: 'E:', version: 'V2' }]);
	});

	/**
	 * The reason the volume names are asked for rather than worked out by reading
	 * a file off each drive letter in turn. Every one of those reads is a mapped
	 * network drive contacted, and a disconnected one costs its own timeout, so a
	 * Flash on a machine with a few stale shares sits there doing nothing visible.
	 */
	it('opens nothing on a drive that is not named MICROBIT', async () => {
		const io = fakeIo({}, { 'Z:\\DETAILS.TXT': V2_DETAILS }, [
			{ name: 'Backups', path: 'Z:' },
			{ name: 'MBED', path: 'F:' },
			{ name: '', path: 'G:' },
		]);

		expect(await findBoards(io, windows)).toEqual([]);
		expect(io.opened).toEqual([]);
	});

	/** Nothing on any other platform is touched before its name has matched either. */
	it('opens nothing on a volume that is not named MICROBIT', async () => {
		const io = fakeIo({ '/Volumes': ['Macintosh HD', 'Time Machine', 'MBED']}, {});

		expect(await findBoards(io, mac)).toEqual([]);
		expect(io.opened).toEqual([]);
	});

	/** A renamed stick gets exactly two reads, and neither one finds a board. */
	it('opens only the two DAPLink files on a volume that is named MICROBIT', async () => {
		const io = fakeIo({ '/Volumes': ['MICROBIT'] }, { '/Volumes/MICROBIT/holiday-photos.zip': 'not a board' });

		expect(await findBoards(io, mac)).toEqual([]);
		expect(io.opened).toEqual(['/Volumes/MICROBIT/DETAILS.TXT', '/Volumes/MICROBIT/MICROBIT.HTM']);
	});

	/**
	 * A machine that will not say what is mounted has not answered "no board", and
	 * the difference is the whole of what the caller tells the user: one is a cable
	 * to plug in, the other is a policy that no amount of retrying gets past.
	 */
	it('fails rather than reporting no boards when Windows will not say what is mounted', async () => {
		const io = fakeIo({}, {});
		io.removableVolumes = () => Promise.reject(new Error('powershell.exe is blocked by policy'));

		await expect(findBoards(io, windows)).rejects.toThrow(/blocked by policy/);
	});

	/** The way out where the search cannot run, so it must not need the search. */
	it('takes a mount point named by the user, without listing anything', async () => {
		const io = fakeIo({}, { 'E:\\DETAILS.TXT': V2_DETAILS });
		io.removableVolumes = () => Promise.reject(new Error('powershell.exe is blocked by policy'));

		expect(await findBoards(io, windows, 'E:')).toEqual([{ path: 'E:', version: 'V2' }]);
	});

	/**
	 * A named path is still checked for a board. Writing on trust would put a
	 * megabyte of hex wherever a typo pointed, and a settings typo is likelier
	 * than most, since this one is only ever set by hand.
	 */
	it('refuses a mount point named by the user that holds no board', async () => {
		const io = fakeIo({}, { '/home/me/notes/todo.txt': 'not a board' });

		expect(await findBoards(io, linux, '/home/me/notes')).toEqual([]);
	});
});
