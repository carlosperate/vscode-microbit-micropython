import { describe, expect, it, vi } from 'vitest';

import { MAX_FILENAME_BYTES, selectFiles, type DirEntry } from '../src/files/select';

/**
 * An in-memory workspace. A `null` value is a folder; a key with a slash is
 * something inside one, and stays out of the root listing because the readers
 * have no way to reach it.
 */
function workspace(tree: Record<string, string | null>) {
	const root: DirEntry[] = [];
	const files = new Map<string, Uint8Array>();

	for (const [path, content] of Object.entries(tree)) {
		if (path.includes('/')) continue;
		root.push({ name: path, isDirectory: content === null });
		if (content !== null) files.set(path, new TextEncoder().encode(content));
	}

	return {
		readDir: async () => root,
		readFile: async (name: string) => {
			const found = files.get(name);
			if (!found) throw new Error(`no such file: ${name}`);
			return found;
		},
	};
}

const select = (tree: Record<string, string | null>, exclude: string[] = []) => {
	const { readDir, readFile } = workspace(tree);
	return selectFiles(readDir, readFile, exclude);
};

const names = (files: { name: string }[]) => files.map((file) => file.name);

const bench = {
	'main.py': 'from microbit import *',
	'data.txt': 'hello',
	'.hidden.py': 'SKIPPED = True',
	'project.hex': ':00000001FF',
	lib: null,
	'lib/helper.py': 'def greet(): pass',
};

describe('what goes on the board', () => {
	it('takes root files, of any extension', async () => {
		const selection = await select(bench);
		expect(names(selection.files)).toEqual(['data.txt', 'main.py']);
	});

	it('skips dotfiles and directories', async () => {
		const selection = await select(bench);
		expect(names(selection.files)).not.toContain('.hidden.py');
		expect(names(selection.files)).not.toContain('lib');
	});

	it('reads the bytes, not just the names', async () => {
		const selection = await select(bench);
		const main = selection.files.find((file) => file.name === 'main.py');
		expect(new TextDecoder().decode(main?.data)).toBe('from microbit import *');
	});

	it('is ordered the same however the directory is read', async () => {
		const forwards = await select(bench);
		const backwards = await select(Object.fromEntries(Object.entries(bench).reverse()));
		expect(names(forwards.files)).toEqual(names(backwards.files));
	});
});

describe('folders', () => {
	it('are named, and nothing inside them is flashed', async () => {
		const selection = await select(bench);
		expect(selection.folders).toEqual(['lib']);
		expect(names(selection.files)).not.toContain('helper.py');
	});

	it('are named once however much they hold', async () => {
		const selection = await select({
			...bench,
			'lib/notes.txt': 'ignore me',
			'lib/sub': null,
			'lib/sub/deep.py': 'x = 1',
		});
		expect(selection.folders).toEqual(['lib']);
	});

	it('are not named when they start with a dot', async () => {
		// Every real workspace has some of these, and naming them on each flash
		// buries the one folder the user was actually asking about.
		const selection = await select({ ...bench, '.git': null, '.vscode': null });
		expect(selection.folders).toEqual(['lib']);
	});

	it('can be silenced with the exclude setting, like a file', async () => {
		const selection = await select({ ...bench, node_modules: null }, ['node_modules']);
		expect(selection.folders).toEqual(['lib']);
	});

	it('are still recorded when silenced, so the reason is findable', async () => {
		// Silent to the user is not the same as gone. Somebody who has just added
		// a folder to the exclude setting needs somewhere to confirm it took.
		const selection = await select({ ...bench, '.git': null, node_modules: null }, ['node_modules']);
		expect(selection.skipped).toContainEqual({ name: '.git', reason: 'dotfile', notable: false });
		expect(selection.skipped).toContainEqual({ name: 'node_modules', reason: 'excluded', notable: false });
	});

	it('are never opened, so a huge tree costs nothing', async () => {
		// The reader has no way into a folder, so the only thing left to get wrong
		// is opening the folder itself as if it were a file.
		const readFile = vi.fn(async () => new TextEncoder().encode('x = 1'));
		const selection = await selectFiles(
			async () => [
				{ name: 'main.py', isDirectory: false },
				{ name: 'lib', isDirectory: true },
			],
			readFile,
			[]
		);

		expect(selection.folders).toEqual(['lib']);
		expect(readFile.mock.calls.flat()).toEqual(['main.py']);
	});
});

describe('a hex in the workspace', () => {
	it('is left out, because it is what this extension puts there', async () => {
		// Saving with no download bridge writes the hex beside the code. Taken back
		// in, it is orders of magnitude past the device filesystem, so the next
		// build is refused over a file the user never created.
		const selection = await select(bench);

		expect(names(selection.files)).not.toContain('project.hex');
		expect(selection.skipped).toContainEqual({ name: 'project.hex', reason: 'build-output', notable: false });
	});

	it('is left out whatever the case, since a name off a FAT drive shouts', async () => {
		const selection = await select({ 'main.py': 'x = 1', 'PROJECT.HEX': ':00000001FF' });

		expect(names(selection.files)).toEqual(['main.py']);
	});

	it('is never opened, so the read it would cost never happens', async () => {
		const readFile = vi.fn(async () => new TextEncoder().encode('x = 1'));

		await selectFiles(
			async () => [
				{ name: 'main.py', isDirectory: false },
				{ name: 'project.hex', isDirectory: false },
			],
			readFile,
			[]
		);

		expect(readFile.mock.calls.flat()).toEqual(['main.py']);
	});
});

describe('names the device cannot hold', () => {
	it('measures the limit in UTF-8 bytes, not characters', async () => {
		// 61 emoji is 61 characters, 122 UTF-8 bytes: over the limit while a
		// `.length` check would wave it through.
		const emoji = '\u{1F600}'.repeat(61);
		expect([...emoji].length).toBeLessThan(MAX_FILENAME_BYTES);
		expect(new TextEncoder().encode(emoji).length).toBeGreaterThan(MAX_FILENAME_BYTES);

		const selection = await select({ [emoji]: 'x = 1' });
		expect(selection.files).toEqual([]);
		expect(selection.skipped).toEqual([{ name: emoji, reason: 'name-too-long', notable: true }]);
	});

	it('accepts a name of exactly the limit and refuses one byte more', async () => {
		const atLimit = 'a'.repeat(MAX_FILENAME_BYTES);
		const overLimit = 'a'.repeat(MAX_FILENAME_BYTES + 1);
		const selection = await select({ [atLimit]: 'x = 1', [overLimit]: 'x = 1' });
		expect(names(selection.files)).toEqual([atLimit]);
	});

	it('refuses a name containing a slash', async () => {
		// Not reachable through a real directory listing, and the filesystem
		// library writes it onto the device without complaint, so it is checked
		// here rather than trusted to be impossible.
		const selection = await selectFiles(
			async () => [{ name: 'a/b.py', isDirectory: false }],
			async () => new TextEncoder().encode('x = 1'),
			[]
		);
		expect(selection.files).toEqual([]);
		expect(selection.skipped).toEqual([{ name: 'a/b.py', reason: 'name-has-slash', notable: true }]);
	});
});

describe('empty files', () => {
	it('leaves them out, because the filesystem library throws on them', async () => {
		const selection = await select({ 'main.py': 'x = 1', 'notes.txt': '' });
		expect(names(selection.files)).toEqual(['main.py']);
	});

	it('is worth mentioning for a .py file and not for anything else', async () => {
		const selection = await select({ 'empty.py': '', 'empty.txt': '' });
		expect(selection.skipped).toEqual([
			{ name: 'empty.py', reason: 'empty', notable: true },
			{ name: 'empty.txt', reason: 'empty', notable: false },
		]);
	});

	it('leaves nothing to flash when every file is empty', async () => {
		const selection = await select({ 'a.py': '', 'b.py': '' });
		expect(selection.files).toEqual([]);
	});
});

describe('the exclude setting', () => {
	it('excludes nothing by default', async () => {
		const selection = await select(bench);
		expect(names(selection.files)).toEqual(['data.txt', 'main.py']);
	});

	it('matches a plain name', async () => {
		const selection = await select(bench, ['data.txt']);
		expect(names(selection.files)).toEqual(['main.py']);
	});

	it('matches a star', async () => {
		const selection = await select(bench, ['*.txt']);
		expect(names(selection.files)).toEqual(['main.py']);
	});

	it('records the exclusion without calling it notable', async () => {
		const selection = await select(bench, ['data.txt']);
		expect(selection.skipped).toContainEqual({ name: 'data.txt', reason: 'excluded', notable: false });
	});

	it('can exclude everything', async () => {
		const selection = await select(bench, ['*']);
		expect(selection.files).toEqual([]);
	});
});
