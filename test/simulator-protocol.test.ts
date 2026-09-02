/**
 * What crosses between the extension host and the simulator document.
 */
import { expect, it } from 'vitest';

import { fromBase64, isMessage, toBase64, toFilesystem } from '../src/simulator/protocol';

it('round trips bytes that are not valid UTF-8', () => {
	const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a]);
	expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
});

it('round trips an empty file', () => {
	expect(toBase64(new Uint8Array())).toBe('');
	expect(fromBase64('').length).toBe(0);
});

/** `String.fromCharCode(...bytes)` overflows the stack well below this size. */
it('round trips a file larger than the chunk size', () => {
	const bytes = new Uint8Array(200_000).map((_, at) => at % 256);
	const encoded = toBase64(bytes);
	expect(fromBase64(encoded)).toEqual(bytes);
});

it('builds a filesystem record without touching the prototype', () => {
	const filesystem = toFilesystem([
		{ name: 'main.py', data: toBase64(new Uint8Array([1, 2])) },
		{ name: '__proto__', data: toBase64(new Uint8Array([3])) },
	]);
	expect(Object.keys(filesystem).sort()).toEqual(['__proto__', 'main.py']);
	expect([...filesystem['__proto__']]).toEqual([3]);
	expect(Object.getPrototypeOf(filesystem)).toBe(Object.prototype);
});

it('recognises a message by its kind and nothing else', () => {
	expect(isMessage({ kind: 'ready', state: {} })).toBe(true);
	expect(isMessage({ kind: 42 })).toBe(false);
	expect(isMessage(null)).toBe(false);
	expect(isMessage('ready')).toBe(false);
});
