/**
 * MicroPython images are committed rather than downloaded, so nothing verifies
 * them at build time. This performs some checks.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import firmware from '../assets/firmware/firmware.json';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'assets', 'firmware');

it('firmware.json lists every hex in assets/firmware/', () => {
	const onDisk = readdirSync(dir)
		.filter((name) => name.endsWith('.hex'))
		.sort();
	const listed = Object.values(firmware)
		.map((entry) => entry.file)
		.sort();
	expect(onDisk).toEqual(listed);
});

// The suite is named after the file, not the board, so a failing run says which
// image to go and look at.
for (const [board, entry] of Object.entries(firmware)) {
	describe(`${board}, ${entry.file}`, () => {
		const hex = path.join(dir, entry.file);

		it('is present', () => {
			expect(existsSync(hex), `${entry.file} is missing from assets/firmware/`).toBe(true);
		});

		it('matches the recorded sha256', async () => {
			const bytes = await readFile(hex);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
		});

		it('is a complete Intel hex', async () => {
			const text = await readFile(hex, 'utf8');
			expect(text.startsWith(':')).toBe(true);
			// The EOF record. Its absence means the file was cut short.
			expect(text.trimEnd().endsWith(':00000001FF')).toBe(true);
		});
	});
}
