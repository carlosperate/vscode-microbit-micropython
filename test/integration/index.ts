import * as vscode from 'vscode';

import { chooseWorkspaceRoot, selectWorkspaceFiles } from '../../src/files/workspace';
import { readFirmware } from '../../src/hex/assets';
import { buildFs, generateHex } from '../../src/hex/build';

/**
 * The integration tests: the same bundle run on two hosts, `@vscode/test-web` in
 * a browser and `@vscode/test-electron` on the desktop. It exists for the things
 * a stubbed `vscode` cannot see, above all whether the manifest and the code
 * agree about what this extension contributes.
 *
 * Every check reports before it asserts, so a failing run says which assumption
 * broke rather than stopping at the first one.
 */
const EXTENSION_ID = 'carlosperate.microbit-micropython';

interface Result {
	name: string;
	ok: boolean;
	detail: string;
}
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string): void {
	results.push({ name, ok, detail });
	console.log(`[test] ${ok ? 'PASS' : 'FAIL'}  ${name}\n[test]       ${detail}`);
}

/**
 * The bench is one folder, so the root is taken directly rather than through
 * `chooseWorkspaceRoot`, which would put a quick pick in front of a headless run
 * the moment a second root existed.
 */
const benchRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri;

export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(
			`${EXTENSION_ID} is not loaded. --extensionTestsPath must point inside ` +
				'--extensionDevelopmentPath, or the script runs in a host this extension does not exist in.'
		);
	}

	await checkActivation(extension);
	await checkContributedCommandsResolve(extension);
	await checkSelectionOnTheRealWorkspace();
	await checkHexBuildsFromTheRealWorkspace(extension);
	await reportWebUsb();

	// Last, and never in the middle. Replacing workspace folder 0 may terminate
	// and restart every running extension, this script included, so anything after
	// it can be cut off with no summary printed. On a slow runner that reads as a
	// suite that vanished rather than one that failed.
	await checkSelectionFollowsTheRoot();

	summarise();
}

/**
 * Reading a file that ships inside the extension is the one thing that differs
 * most between the two hosts: `extensionUri` is a real `file:` URI on the
 * desktop, which `fetch` refuses outright, and an http URL in a browser, which
 * answers a missing file with an error page and a 200 rather than a failure.
 * Only a real host has an `extensionUri` at all, so nothing below this layer
 * can tell whether the reader in use works on it.
 *
 * The build that follows is the heaviest thing this extension does, a megabyte
 * of Intel hex parsed and reassembled, and it happens inside a Web Worker on
 * both hosts. Unit tests run it in Node, where a great deal more is available.
 */
async function checkHexBuildsFromTheRealWorkspace(extension: vscode.Extension<unknown>): Promise<void> {
	let images;
	try {
		images = await Promise.all([
			readFirmware(extension.extensionUri, 'V1'),
			readFirmware(extension.extensionUri, 'V2'),
		]);
	} catch (error) {
		record('the shipped firmware is readable', false, `from ${extension.extensionUri}: ${String(error)}`);
		return;
	}
	record(
		'the shipped firmware is readable',
		true,
		`${images.map((image) => `${image.file} (${image.hex.length} characters)`).join(', ')}`
	);

	const root = benchRoot();
	if (!root) {
		record('a hex builds from the workspace', false, 'no workspace folder to build from');
		return;
	}

	const selection = await selectWorkspaceFiles(root);
	if (!selection.files.length) {
		record('a hex builds from the workspace', false, 'the workspace had no files to build from');
		return;
	}

	try {
		const { hex, used, available } = generateHex(buildFs(images, selection.files));
		record(
			'a hex builds from the workspace',
			hex.startsWith(':'),
			`${hex.length} characters, using ${used} of ${available} bytes of storage`
		);
	} catch (error) {
		record('a hex builds from the workspace', false, String(error));
	}
}

/**
 * The selection rules are unit-tested against injected readers; this is the only
 * place they meet a real `workspace.fs`, on a virtual scheme in the browser and
 * real `file:` URIs on the desktop.
 */
async function checkSelectionOnTheRealWorkspace(): Promise<void> {
	const root = benchRoot();
	if (!root) {
		record('selection reads the real workspace', false, 'no workspace folder to read');
		return;
	}

	const selection = await selectWorkspaceFiles(root);
	const names = selection.files.map((file) => file.name).sort();

	record(
		'selection reads the real workspace',
		names.join(',') === 'data.txt,main.py' && selection.folders.join(',') === 'lib',
		`files=[${names.join(', ')}], folders=[${selection.folders.join(', ')}]`
	);
}

/**
 * A host can swap the workspace folder in place, and a root captured once goes
 * stale with nothing to notice it. Worth checking in a real host because
 * `vscode-test-web` accepts `updateWorkspaceFolders` and reports the new folder
 * while never delivering `onDidChangeWorkspaceFolders`: anything that refreshed
 * itself from that event would pass its own unit tests and be wrong here.
 */
async function checkSelectionFollowsTheRoot(): Promise<void> {
	const original = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!original) {
		record('selection follows a swapped root', false, 'no workspace folder to swap');
		return;
	}

	const elsewhere = vscode.Uri.joinPath(original, 'lib');
	const swapped = vscode.workspace.updateWorkspaceFolders(0, 1, { uri: elsewhere });
	if (!swapped) {
		record('selection follows a swapped root', false, 'updateWorkspaceFolders refused the swap');
		return;
	}

	// Through `chooseWorkspaceRoot`, because it is what reads `workspaceFolders`
	// now and so it is what could go stale. One folder means it answers without
	// putting a quick pick in front of a headless run.
	const root = await chooseWorkspaceRoot();
	if (!root) {
		record('selection follows a swapped root', false, 'no root came back after the swap');
		return;
	}

	const selection = await selectWorkspaceFiles(root);
	const names = selection.files.map((file) => file.name);
	record(
		'selection follows a swapped root',
		names.join(',') === 'helper.py',
		`after swapping the root to lib/: files=[${names.join(', ')}]`
	);

	// The root is left swapped. Restoring it would be a second
	// `updateWorkspaceFolders` without waiting for the change event in between,
	// which the API says not to do, and the window this runs in is thrown away.
}

/**
 * There is no unhandled-rejection check here, and that is deliberate.
 *
 * `self` in the extension host is a `DedicatedWorkerGlobalScope` and
 * `addEventListener('unhandledrejection', …)` attaches without complaint, but the
 * listener never fires: a bare `Promise.reject()` from inside the host goes
 * unseen. Even if it did fire, `onStartupFinished` means the extension is already
 * active before this script loads, so an activation rejection would be long past
 * and `extension.activate()` would only replay a cached result.
 *
 * A check that cannot fail reads as coverage and provides none. Catching this
 * would need a seam in the extension itself, which is not worth adding for it.
 */

/**
 * An activation that throws leaves the extension registered but inert, and says
 * nothing in the UI, so this is the check that turns "the extension does
 * nothing" into a named failure. A failure that already happened at startup is
 * replayed here, because `activate()` hands back the cached result.
 */
async function checkActivation(extension: vscode.Extension<unknown>): Promise<void> {
	try {
		await extension.activate();
	} catch (error) {
		record('activation completes', false, `activate() threw: ${String(error)}`);
		return;
	}

	record('activation completes', extension.isActive, `isActive=${extension.isActive}`);
}

/**
 * The manifest and the registrations live in different files, so they drift
 * silently: the palette lists a contributed command whatever happens, and only
 * running it reveals there is no handler. Read the ids from the manifest at
 * runtime rather than repeating them here, or this check only ever proves that
 * two copies of the same typo agree.
 */
async function checkContributedCommandsResolve(extension: vscode.Extension<unknown>): Promise<void> {
	const contributed: string[] = (extension.packageJSON?.contributes?.commands ?? []).map(
		(command: { command: string }) => command.command
	);

	if (contributed.length === 0) {
		record('contributed commands resolve', false, 'the manifest contributes no commands at all');
		return;
	}

	// `true` includes commands that are registered but not shown in the palette.
	const registered = await vscode.commands.getCommands(true);
	const missing = contributed.filter((id) => !registered.includes(id));
	record(
		'contributed commands resolve',
		missing.length === 0,
		missing.length
			? `${missing.length} of ${contributed.length} contributed but never registered: ${missing.join(', ')}`
			: `all ${contributed.length} contributed commands are registered`
	);
}

/**
 * Reported, never asserted. WebUSB reaching the extension host is a property of
 * whichever workbench is hosting us, not of this extension, and the answer
 * decides whether the device work can be developed against this harness at all.
 * A failure here would say nothing about our code.
 */
async function reportWebUsb(): Promise<void> {
	const usb = (navigator as Navigator & { usb?: { getDevices(): Promise<unknown[]> } }).usb;
	if (!usb) {
		record('WebUSB in the extension host', true, 'navigator.usb is absent');
		return;
	}

	try {
		const devices = await usb.getDevices();
		record('WebUSB in the extension host', true, `navigator.usb present, ${devices.length} already authorised`);
	} catch (error) {
		record('WebUSB in the extension host', true, `navigator.usb present, getDevices() threw: ${String(error)}`);
	}
}

function summarise(): void {
	console.log('\n[test] ==== summary ====');
	for (const { name, ok, detail } of results) {
		console.log(`[test] ${ok ? 'PASS' : 'FAIL'}  ${name}`);
		console.log(`[test]       ${detail}`);
	}
	const failed = results.filter((result) => !result.ok);
	if (failed.length) throw new Error(`failed: ${failed.map((result) => result.name).join('; ')}`);
	console.log('[test] ALL PASSED');
}
