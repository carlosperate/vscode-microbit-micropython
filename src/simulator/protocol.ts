/**
 * What crosses the two hops between the extension host and the simulator. Pure,
 * and imports nothing: both ends of both hops compile it, including the webview
 * bundle, which has neither `vscode` nor node.
 */

/**
 * Upstream's own kinds, carried through unchanged rather than mirrored into an
 * enum here: a simulator bump that adds one must not need a change on the way.
 */
export interface SimulatorMessage {
	kind: string;
	[field: string]: unknown;
}

/** A workspace file on its way to the board. `data` is base64. */
export interface EncodedFile {
	name: string;
	data: string;
}

/** Extension host to shell. */
export type ToShell =
	| { kind: 'command'; command: SimulatorMessage }
	| { kind: 'files'; files: EncodedFile[] };

/**
 * Shell to extension host. `failed` means the document cannot run and only the
 * firmware check sends it; `error` is anything else uncaught, and is logged.
 */
export type FromShell =
	| { kind: 'ready' }
	| { kind: 'notification'; notification: SimulatorMessage }
	| { kind: 'control'; control: 'stop' | 'reset' | 'sound'; on?: boolean }
	| { kind: 'failed'; detail: string }
	| { kind: 'error'; detail: string };

/** Ours, on the way in, so the shell can skip what it sent itself. */
export const FROM_SHELL = '__fromShell';

/** Neither end throws on a message it does not know. */
export const isMessage = (value: unknown): value is SimulatorMessage =>
	typeof value === 'object' && value !== null && typeof (value as SimulatorMessage).kind === 'string';

/** `String.fromCharCode(...bytes)` spreads every byte as an argument and
 *  overflows the stack on a large file, which is the case nobody tests. Small
 *  enough to stay clear of that limit, and of any device figure. */
const CHUNK = 512;

export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let at = 0; at < bytes.length; at += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
	}
	return btoa(binary);
}

export function fromBase64(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
	return bytes;
}

/**
 * `Object.fromEntries` and never `record[name] = data`: a file called
 * `__proto__` would set the prototype instead of adding an entry, and upstream's
 * own filesystem check would not notice it missing.
 */
export const toFilesystem = (files: readonly EncodedFile[]): Record<string, Uint8Array> =>
	Object.fromEntries(files.map((file) => [file.name, fromBase64(file.data)]));
