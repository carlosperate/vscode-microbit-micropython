import { describe, expect, it } from 'vitest';

import { hexFilename, MAX_FILENAME } from '../src/filename';

describe('the name the hex is offered under', () => {
	it('is the folder the code came from', () => {
		expect(hexFilename('my-project')).toBe('my-project.hex');
	});

	it('replaces spaces, one dash however many there were', () => {
		expect(hexFilename('my  first program')).toBe('my-first-program.hex');
	});

	it('replaces every character FAT reserves in a long name', () => {
		expect(hexFilename('a/b:c*d?')).toBe('a-b-c-d.hex');
		expect(hexFilename('a\\b<c>d"e|f')).toBe('a-b-c-d-e-f.hex');
	});

	it('replaces control and format characters, which FAT cannot hold', () => {
		// Built rather than written out. They are invisible in a source file, which
		// is why a folder name carrying one looks fine and then will not save.
		const control = (code: number) => String.fromCharCode(code);

		expect(hexFilename(`a${control(0)}b${control(0x1f)}c${control(0x7f)}d`)).toBe('a-b-c-d.hex');
	});

	it('steps around the DOS device names FAT still reserves', () => {
		// `con.hex` is refused on a FAT drive however ordinary `con` was as a
		// folder, and prefixing keeps a name its owner recognises. The rule reaches
		// as far as the first dot, so appending an extension never escapes it.
		expect(hexFilename('con')).toBe('microbit-con.hex');
		expect(hexFilename('COM4')).toBe('microbit-COM4.hex');
		expect(hexFilename('con.old')).toBe('microbit-con.old.hex');
		expect(hexFilename('console')).toBe('console.hex');
		expect(hexFilename('com10')).toBe('com10.hex');
	});

	it('checks for one after the trimming, not before it', () => {
		// `con ` and `con-` are ordinary folder names on macOS and Linux, and both
		// come out of the trim as a bare `con`. Checked any earlier, the trim is
		// what hands back the exact name the check exists to prevent.
		expect(hexFilename('con ')).toBe('microbit-con.hex');
		expect(hexFilename('con-')).toBe('microbit-con.hex');
		expect(hexFilename('aux.')).toBe('microbit-aux.hex');
		expect(hexFilename('com1 ')).toBe('microbit-com1.hex');
	});

	it('never begins or ends with a dot, which FAT strips in silence', () => {
		expect(hexFilename('.hidden.')).toBe('hidden.hex');
	});

	it('keeps a folder named in another language', () => {
		// FAT holds a long name as UCS-2, so all of this is storable, and a learner
		// who cannot recognise their own project is worse off than one whose
		// filename is unusual.
		expect(hexFilename('проект')).toBe('проект.hex');
		expect(hexFilename('プロジェクト')).toBe('プロジェクト.hex');
	});

	it('falls back to a name of its own when nothing usable is left', () => {
		expect(hexFilename('')).toBe('microbit.hex');
		expect(hexFilename('...')).toBe('microbit.hex');
		expect(hexFilename('///')).toBe('microbit.hex');
	});

	it('counts the extension inside the length it allows itself', () => {
		// The budget is the whole filename. Measured against `MAX_FILENAME` rather
		// than a number written twice, so moving the cap cannot make this pass for
		// the stem alone.
		const name = hexFilename('a'.repeat(300));

		expect([...name]).toHaveLength(MAX_FILENAME);
		expect(name).toMatch(/^a+\.hex$/);
	});

	it('cuts a long name between characters and never through one', () => {
		// Cutting by UTF-16 unit would leave half an emoji behind, and half an
		// emoji is a lone surrogate: it cannot be encoded, so a round trip through
		// UTF-8 comes back with a replacement character where it was.
		const name = hexFilename('\u{1F600}'.repeat(100));

		expect(new TextDecoder().decode(new TextEncoder().encode(name))).toBe(name);
		expect(name.endsWith('.hex')).toBe(true);

		// The budget is in code points, so a name of astral characters is twice
		// this in UTF-16 units. FAT's own limit is the one that has to hold.
		expect([...name]).toHaveLength(MAX_FILENAME);
		expect(name.length).toBeLessThan(255);
	});

	it('does not leave a separator hanging wherever the cut lands', () => {
		// Every cut position, rather than the one that happens to be the boundary
		// today: the trim has to come after the cut for all of them.
		for (let width = 1; width <= MAX_FILENAME + 8; width++) {
			const name = hexFilename(`${'a'.repeat(width)} ${'b'.repeat(MAX_FILENAME)}`);

			expect(name, `cut after ${width}`).not.toMatch(/[-.]\.hex$/);
			expect([...name].length, `cut after ${width}`).toBeLessThanOrEqual(MAX_FILENAME);
		}
	});
});
