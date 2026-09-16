/**
 * Whether a folder's files look like a MicroPython project: any `.py` that is
 * not a dotfile. Nothing stricter, since `main.py` is a convention rather than a
 * rule and a project of one `helper.py` is still one.
 */
export const hasPythonFile = (names: readonly string[]): boolean =>
	names.some((name) => /\.py$/i.test(name) && !name.startsWith('.'));
