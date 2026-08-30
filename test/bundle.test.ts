/**
 * What ships is the bundles, not the source, so these assertions are made
 * against the built bytes. Types cover only the code we wrote: a dependency, or
 * a `globalThis.process` written to get past the compiler, reaches the host
 * unseen by everything else.
 *
 * There are two, one per entry point, and an import crossing between them fails
 * only at runtime and only on the other platform, which is the failure this file
 * exists to turn into a red test.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs config, no types
import { build } from '../config/esbuild.config.mjs';

// Built here rather than read from dist/, so `npm test` needs no prior build.
let outDir: string;
let browser: string;
let node: string;

beforeAll(async () => {
	outDir = await mkdtemp(path.join(tmpdir(), 'microbit-micropython-build-'));
	await build(outDir);
	const read = (name: string) => readFile(path.join(outDir, 'dist', name), 'utf8');
	[browser, node] = await Promise.all([read('browser.js'), read('node.js')]);
}, 60_000);

afterAll(async () => {
	await rm(outDir, { recursive: true, force: true });
});

/** Read inside a test, never at collection: nothing is built until `beforeAll`. */
const bundleFor = (which: string) => (which === 'browser' ? browser : node);
const BOTH = ['browser', 'node'];

it.each(BOTH)('%s is CJS, which is what an extension host loads', (which) => {
	expect(bundleFor(which)).toContain('module.exports');
	expect(bundleFor(which)).not.toMatch(/^\s*export[\s{]/m);
});

it('leaves vscode external in the browser bundle and pulls in nothing else at runtime', () => {
	expect(required(browser)).toEqual(['vscode']);
});

/**
 * Node builtins are the point of this entry, so what is pinned is which ones.
 * Anything new here is a dependency arriving at the desktop host, and the list
 * is short enough that adding to it should be a decision rather than a diff.
 *
 * `child_process` is the one to think twice about: it is here to ask Windows for
 * its volume names, and nothing else may reach for it.
 */
it('reaches for vscode and four node builtins in the node bundle, and nothing else', () => {
	expect(required(node).sort()).toEqual([
		'node:child_process',
		'node:fs/promises',
		'node:os',
		'node:util',
		'vscode',
	]);
});

const required = (bundle: string) => [
	...new Set([...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])),
];

/**
 * Node globals compile clean in a Web Worker and throw there. `setTimeout` is
 * absent from this list on purpose: it exists in both, and the damage it does is
 * a wrong return type, which `test/tsconfig.json` keeps out of `src/` instead.
 *
 * A hit here is a bug even when it comes from a string a user reads. Rename the
 * string, do not loosen the pattern.
 *
 * The dotted three require a property name after the dot, because that is what
 * reading a global looks like and a full stop ending an English sentence is not.
 * esbuild keeps a dependency's doc comments in the output, and one of them ends
 * "discards the IDs in the process."
 */
const nodeGlobals = [
	/\bprocess\s*\.\w/,
	/\bBuffer\s*\.\w/,
	/\b__dirname\b/,
	/\b__filename\b/,
	/\bglobal\.\w/,
	/\bsetImmediate\s*\(/,
];

it.each(nodeGlobals)('the browser bundle does not reach for %s, which the worker does not have', (pattern) => {
	expect(browser).not.toMatch(pattern);
});

/**
 * The desktop host has no WebUSB and no way to reach one, so every symbol below
 * is code that could only fail there. It arrives by an import crossing from the
 * browser entry, which nothing else notices until a user runs the command.
 */
const webUsb = [/\bnavigator\b/, /requestDevice/, /USBDevice/, /microbit-connection/];

it.each(webUsb)('the node bundle does not carry %s', (pattern) => {
	expect(node).not.toMatch(pattern);
});

/**
 * Native serial belongs to the separately installed Eclipse extension, which
 * owns port enumeration and the pseudoterminal on every host. Bundling our own
 * would make this a platform-specific VSIX and there is no reason for one.
 *
 * Lower case only: `SerialPortLike` is a type of ours and is not this.
 */
it.each(BOTH)('the %s bundle has no serial port library of its own', (which) => {
	expect(bundleFor(which)).not.toMatch(/\bserialport\b/);
});
