/**
 * What ships is the bundles, not the source, so these assertions are made
 * against the built bytes. Types cover only the code we wrote: a dependency, or
 * a `globalThis.process` written to get past the compiler, reaches the host
 * unseen by everything else.
 *
 * There are three: one per extension entry point, plus the shell that runs in the
 * simulator's webview document. An import crossing between them fails only at
 * runtime and only on the other platform, which is the failure this file exists
 * to turn into a red test.
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
let webview: string;

beforeAll(async () => {
	outDir = await mkdtemp(path.join(tmpdir(), 'microbit-micropython-build-'));
	await build(outDir);
	const read = (name: string) => readFile(path.join(outDir, 'dist', name), 'utf8');
	[browser, node, webview] = await Promise.all([
		read('browser.js'),
		read('node.js'),
		read(path.join('webview', 'simulator.js')),
	]);
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
 * The board belongs to the manager extension, drive search included, so nothing
 * here needs a node builtin any more. Anything appearing is a dependency
 * arriving at the desktop host, and should be a decision rather than a diff.
 */
it('reaches for vscode alone in the node bundle', () => {
	expect(required(node)).toEqual(['vscode']);
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
 * Every byte that reaches a board goes through the manager extension, so no
 * bundle here may carry a transport of its own: WebUSB, the connection library
 * or a drive search would be a second owner of one board.
 */
const boardAccess = [/\bnavigator\.usb\b/, /requestDevice/, /USBDevice/, /microbit-connection/, /DETAILS\.TXT/];

it.each(boardAccess)('neither extension bundle carries %s', (pattern) => {
	expect(node).not.toMatch(pattern);
	expect(browser).not.toMatch(pattern);
});

/**
 * The types package is `import type` only, so nothing of it may survive into a
 * bundle: a value imported from it would be the day it stopped being types-only.
 */
it.each(BOTH)('the %s bundle carries nothing from the manager API package', (which) => {
	expect(bundleFor(which)).not.toMatch(/vscode-bbcmicrobit-manager-api/);
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

/**
 * The shell is a script tag in a document VS Code did not build, so it is neither
 * a module the host loads nor a caller of the extension API: it reaches the
 * extension only through `acquireVsCodeApi`.
 */
it('the webview bundle is a self-contained IIFE that needs no host', () => {
	expect(webview).not.toContain('module.exports');
	expect(required(webview)).toEqual([]);
	expect(webview).not.toMatch(/\bfrom ["']vscode["']|require\(["']vscode["']\)/);
	expect(webview).toContain('acquireVsCodeApi');
});

/**
 * The prelude has to live in this bundle rather than in a template string in
 * `src/`, where the literal `navigator` would reach the node bundle and fail the
 * WebUSB guard above, which is that guard doing its job.
 */
it('the webview bundle carries the prelude, and the extension bundles do not', () => {
	expect(webview).toMatch(/serviceWorker/);
	expect(browser).not.toMatch(/serviceWorker/);
	expect(node).not.toMatch(/serviceWorker/);
});

/** The stylesheet is imported as text and injected as one tag, not fetched. */
it('the webview bundle carries its stylesheet inline', () => {
	expect(webview).toContain('--vscode-button-secondaryBackground');
});
