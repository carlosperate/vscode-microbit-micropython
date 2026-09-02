/**
 * The insertion into upstream's `simulator.html`, which is pure string work.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { simulatorDocument } from '../src/simulator/content';

const here = path.dirname(fileURLToPath(import.meta.url));
const upstream = await readFile(
	path.join(here, '..', 'assets', 'simulator', 'simulator.html'),
	'utf8'
);

const URIS = {
	assets: 'https://example.test/assets/simulator',
	script: 'https://example.test/dist/webview/simulator.js',
	cspSource: 'https://example.test',
};

const document = simulatorDocument(upstream, URIS);

it('inserts the three tags, in order, right after <head>', () => {
	const inserted = document.slice(document.indexOf('<head>'), document.indexOf('</head>'));
	const order = [
		inserted.indexOf('http-equiv="Content-Security-Policy"'),
		inserted.indexOf('<base href='),
		inserted.indexOf('<script src="https://example.test/dist'),
	];
	expect(order.every((at) => at > 0)).toBe(true);
	expect([...order].sort((a, b) => a - b)).toEqual(order);
});

/** An upstream bump has to bring its own markup, not a fork of ours. */
it('leaves upstream’s markup byte-identical either side of the block', () => {
	const ours = ['Content-Security-Policy', '<base href=', 'https://example.test/dist'];
	const without = document
		.split('\n')
		.filter((line) => !ours.some((tag) => line.includes(tag)))
		.join('\n');
	expect(without).toBe(upstream);
});

/** The base is what makes upstream's relative scripts and its wasm fetch resolve. */
it('gives the base a trailing slash', () => {
	expect(document).toContain(`<base href="${URIS.assets}/">`);
});

/** Each of these was measured: without it the board renders and never runs, or
 *  loses every inline style the board SVG has. */
it('carries the directives the simulator needs', () => {
	const csp = document.match(/content="([^"]+)"/)?.[1] ?? '';
	expect(csp).toContain("default-src 'none'");
	expect(csp).toContain("'wasm-unsafe-eval'");
	expect(csp).toContain(`connect-src ${URIS.cspSource}`);
	expect(csp).toContain(`style-src ${URIS.cspSource} 'unsafe-inline'`);
	expect(csp).not.toContain('nonce');
});

it('refuses a document it cannot place the block in', () => {
	expect(() => simulatorDocument('<html><body>no head</body></html>', URIS)).toThrow(/exactly one <head>/);
	expect(() => simulatorDocument('<head></head><head></head>', URIS)).toThrow(/exactly one <head>/);
});

/** `<header>` starts with the same five characters. */
it('is not fooled by a header element', () => {
	const html = '<html><head></head><body><header>hi</header></body></html>';
	expect(simulatorDocument(html, URIS)).toContain('<header>hi</header>');
});
