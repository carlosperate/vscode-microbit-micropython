/**
 * `assets/simulator/` is build output, committed and rebuilt only by hand.
 */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import simulator from '../assets/simulator/simulator.json';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'assets', 'simulator');

/** The runtime files plus the licence notice MIT asks to travel with the copies.
 *  A file the build stops copying would drop out of the manifest as well, so the
 *  names are pinned here rather than read back from it. */
const FILES = [
	'LICENSE',
	'build/firmware.js',
	'build/firmware.wasm',
	'build/simulator.js',
	'simulator.html',
];

const listed = simulator.files.map((entry) => entry.file).sort();

/** Posix-relative, and without the manifest that lists them. */
function walk(folder: string, prefix = ''): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? walk(path.join(folder, entry.name), `${prefix}${entry.name}/`)
			: [`${prefix}${entry.name}`]
	);
}

it('the manifest lists exactly the files the extension needs', () => {
	expect(listed).toEqual([...FILES].sort());
});

/** Both directions, so a stray file in the folder fails as loudly as a missing
 *  one: whatever ships has to be something the build put there. */
it('simulator.json lists every file in assets/simulator/', () => {
	const onDisk = walk(dir)
		.filter((name) => name !== 'simulator.json')
		.sort();
	expect(onDisk).toEqual(listed);
});

/** Lose these and nothing says which source the committed binaries came from. */
it('records what it was built from', () => {
	expect(simulator.ref).toMatch(/^v\d+\.\d+\.\d+$/);
	expect(simulator.builtWith.emscripten).toContain('3.1.25');
	for (const key of ['simulator', 'micropython-microbit-v2', 'micropython'] as const) {
		expect(simulator.builtWith[key], `${key} commit is missing`).toMatch(/^[0-9a-f]{40}$/);
	}
});

it.each(simulator.files)('$file matches the recorded sha256', async (entry) => {
	const bytes = await readFile(path.join(dir, ...entry.file.split('/')));
	expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
});

/** A script upstream adds and we do not copy fails only at runtime, as a
 *  simulator that never boots. */
it('simulator.html loads only scripts that were copied', async () => {
	const html = await readFile(path.join(dir, 'simulator.html'), 'utf8');
	const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
	expect(sources.length).toBeGreaterThan(0);
	for (const source of sources) {
		expect(FILES, `${source} is loaded but was not copied`).toContain(source);
	}
});

it('the WebAssembly is a real Wasm module', async () => {
	const bytes = await readFile(path.join(dir, 'build/firmware.wasm'));
	// `\0asm`. A truncated file fails here, not as a blank simulator later.
	expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
});
