import * as vscode from 'vscode';

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
	await reportWebUsb();

	summarise();
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
