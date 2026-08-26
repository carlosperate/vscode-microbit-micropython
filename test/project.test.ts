import { describe, expect, it } from 'vitest';

import { projectPath, relativeTo } from '../src/files/project';

const segments = (configured: unknown) => {
	const resolved = projectPath(configured);
	return 'segments' in resolved ? resolved.segments : resolved.refused;
};

describe('the configured project folder', () => {
	it('is the workspace folder when nothing is set', () => {
		expect(segments(undefined)).toEqual([]);
		expect(segments('')).toEqual([]);
		expect(segments('.')).toEqual([]);
		expect(segments('   ')).toEqual([]);
	});

	it('takes a folder below the workspace folder', () => {
		expect(segments('src')).toEqual(['src']);
		expect(segments('src/board')).toEqual(['src', 'board']);
	});

	it('forgives every way a human writes the same path', () => {
		// All four of these will be typed into a settings file by somebody.
		expect(segments('./src')).toEqual(['src']);
		expect(segments('src/')).toEqual(['src']);
		expect(segments('src\\board')).toEqual(['src', 'board']);
		expect(segments('./src//board/')).toEqual(['src', 'board']);
	});

	it('refuses a path that leaves the workspace', () => {
		expect(segments('..')).toBe('outside-the-workspace');
		expect(segments('../elsewhere')).toBe('outside-the-workspace');
		expect(segments('src/../..')).toBe('outside-the-workspace');
	});

	it('refuses an absolute path, in either notation', () => {
		expect(segments('/etc')).toBe('outside-the-workspace');
		expect(segments('\\etc')).toBe('outside-the-workspace');
		expect(segments('C:\\Windows')).toBe('outside-the-workspace');
	});

	it('refuses a URI, whatever the scheme is spelled with', () => {
		// A scheme is not all letters, and one that slips through is joined onto
		// the workspace folder as though it were the name of a folder.
		expect(segments('file:///etc')).toBe('outside-the-workspace');
		expect(segments('vscode-vfs://host/repo')).toBe('outside-the-workspace');
		expect(segments('git+ssh://host/repo')).toBe('outside-the-workspace');
		expect(segments('s3:bucket')).toBe('outside-the-workspace');
	});

	it('still takes a folder name that merely looks technical', () => {
		expect(segments('vscode-vfs')).toEqual(['vscode-vfs']);
		expect(segments('src.old')).toEqual(['src.old']);
		expect(segments('v1.2')).toEqual(['v1.2']);
	});

	it('refuses anything that is not a path at all', () => {
		// `"type": "string"` in the manifest is a hint to the settings editor, and
		// whatever is in the JSON arrives exactly as it was written.
		expect(segments(5)).toBe('not-a-string');
		expect(segments(['src'])).toBe('not-a-string');
		expect(segments(null)).toBe('not-a-string');
		expect(segments(true)).toBe('not-a-string');
	});

	it('answers with a value rather than throwing, so the caller words it', () => {
		// The core holds no message strings: the same refusal reads differently in
		// a notification and in the output channel.
		expect(() => projectPath('..')).not.toThrow();
		expect(projectPath('..')).toEqual({ refused: 'outside-the-workspace' });
	});
});

describe('a folder somebody picked', () => {
	it('is stored as a path relative to the workspace folder', () => {
		expect(relativeTo('/a/proj', '/a/proj/src')).toBe('src');
		expect(relativeTo('/a/proj', '/a/proj/src/board')).toBe('src/board');
	});

	it('is the empty default when it is the workspace folder itself', () => {
		expect(relativeTo('/a/proj', '/a/proj')).toBe('');
		expect(relativeTo('/a/proj/', '/a/proj')).toBe('');
		expect(relativeTo('/a/proj', '/a/proj/')).toBe('');
	});

	it('is refused when it is outside the workspace folder', () => {
		// A folder dialog will go anywhere on the machine, so this is the check
		// that keeps what it hands back inside the workspace.
		expect(relativeTo('/a/proj', '/etc')).toBeUndefined();
		expect(relativeTo('/a/proj', '/a')).toBeUndefined();
		expect(relativeTo('/a/proj', '/a/other/src')).toBeUndefined();
	});

	it('requires a separator, so a sibling with a longer name is not a child', () => {
		expect(relativeTo('/a/proj', '/a/project')).toBeUndefined();
		expect(relativeTo('/a/proj', '/a/proj-old/src')).toBeUndefined();
	});

	it('works at the root of a filesystem, where the separator doubles up', () => {
		expect(relativeTo('/', '/src')).toBe('src');
		expect(relativeTo('/', '/')).toBe('');
	});
});
