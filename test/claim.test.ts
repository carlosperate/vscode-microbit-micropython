import { describe, expect, it } from 'vitest';

import { hasPythonFile } from '../src/files/claim';

describe('what looks like a MicroPython project', () => {
	it('is any Python file, not only main.py', () => {
		expect(hasPythonFile(['main.py'])).toBe(true);
		expect(hasPythonFile(['README.md', 'helper.PY'])).toBe(true);
	});

	/** Dotfiles never reach the board, so they never speak for the folder either. */
	it('ignores dotfiles', () => {
		expect(hasPythonFile(['.hidden.py'])).toBe(false);
	});

	it('is nothing without one', () => {
		expect(hasPythonFile([])).toBe(false);
		expect(hasPythonFile(['main.cpp', 'project.hex', 'notes.txt'])).toBe(false);
	});
});
