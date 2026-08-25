/**
 * What ships is the bundle, not the source, so these assertions are made
 * against the built bytes. Types cover only the code we wrote: a dependency, or
 * a `globalThis.process` written to get past the compiler, reaches the Web
 * Worker unseen by everything else.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs config, no types
import { build } from '../config/esbuild.config.mjs';

// Built here rather than read from dist/, so `npm test` needs no prior build.
let outDir: string;
let bundle: string;

beforeAll(async () => {
	outDir = await mkdtemp(path.join(tmpdir(), 'microbit-micropython-build-'));
	await build(outDir);
	bundle = await readFile(path.join(outDir, 'dist', 'extension.js'), 'utf8');
}, 60_000);

afterAll(async () => {
	await rm(outDir, { recursive: true, force: true });
});

it('is CJS, which is what the extension host worker loads', () => {
	expect(bundle).toContain('module.exports');
	expect(bundle).not.toMatch(/^\s*export[\s{]/m);
});

it('leaves vscode external and pulls in nothing else at runtime', () => {
	const required = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
	expect([...new Set(required)]).toEqual(['vscode']);
});

/**
 * Node globals compile clean in a Web Worker and throw there. `setTimeout` is
 * absent from this list on purpose: it exists in both, and the damage it does is
 * a wrong return type, which `test/tsconfig.json` keeps out of `src/` instead.
 *
 * A hit here is a bug even when it comes from a string a user reads. Rename the
 * string, do not loosen the pattern.
 */
const nodeGlobals = [
	/\bprocess\s*\./,
	/\bBuffer\s*\./,
	/\b__dirname\b/,
	/\b__filename\b/,
	/\bglobal\./,
	/\bsetImmediate\s*\(/,
];

it.each(nodeGlobals)('does not reach for %s, which the worker does not have', (pattern) => {
	expect(bundle).not.toMatch(pattern);
});
