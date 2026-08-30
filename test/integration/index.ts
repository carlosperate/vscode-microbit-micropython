import { microbitBoardId } from '@microbit/microbit-fs';
import * as vscode from 'vscode';

import { COMMANDS, SECTION, SERIAL_MONITOR_EXTENSION, SETTINGS } from '../../src/config';
import { hexFilename } from '../../src/filename';
import { chooseWorkspaceFolder, resolveProject, selectWorkspaceFiles } from '../../src/files/workspace';
import { readFirmware } from '../../src/hex/assets';
import { buildFs, generateHex } from '../../src/hex/build';
import { connectToBoard, type UsbIdentity } from '../../src/usb/connect';

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
 * `chooseWorkspaceFolder`, which would put a quick pick in front of a headless run
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
	await checkTheHostLoadedItsOwnEntry(extension);
	await checkBothEntriesShip(extension);
	checkItRunsBesideTheHardware(extension);
	checkAMountPointJoinsToAFile();
	await checkContributedCommandsResolve(extension);
	await checkSerialMonitorCompanion();
	await checkSelectionOnTheRealWorkspace();
	const built = await checkHexBuildsFromTheRealWorkspace(extension);
	if (built) await checkTheHexSurvivesBeingSaved(built);
	await checkSelectionFollowsTheProjectFolder();
	await reportWebUsb();
	await checkTheChooserIsNeverReached(await reportTheUsbBridge());
	await checkAHostileNavigatorIsSurvived(extension);

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
async function checkHexBuildsFromTheRealWorkspace(
	extension: vscode.Extension<unknown>
): Promise<string | undefined> {
	let images;
	try {
		images = await Promise.all([
			readFirmware(extension.extensionUri, 'V1'),
			readFirmware(extension.extensionUri, 'V2'),
		]);
	} catch (error) {
		record('the shipped firmware is readable', false, `from ${extension.extensionUri}: ${String(error)}`);
		return undefined;
	}
	record(
		'the shipped firmware is readable',
		true,
		`${images.map((image) => `${image.file} (${image.hex.length} characters)`).join(', ')}`
	);

	const root = benchRoot();
	if (!root) {
		record('a hex builds from the workspace', false, 'no workspace folder to build from');
		return undefined;
	}

	const selection = await selectWorkspaceFiles(root);
	if (!selection.files.length) {
		record('a hex builds from the workspace', false, 'the workspace had no files to build from');
		return undefined;
	}

	try {
		const { hex, used, available } = generateHex(buildFs(images, selection.files));
		record(
			'a hex builds from the workspace',
			hex.startsWith(':'),
			`${hex.length} characters, using ${used} of ${available} bytes of storage`
		);
		return hex;
	} catch (error) {
		record('a hex builds from the workspace', false, String(error));
		return undefined;
	}
}

/**
 * The write Save Hex ends in, against whichever scheme this host gave the
 * workspace: virtual in the browser, real `file:` URIs on the desktop. Only a
 * real host has either, and a megabyte of Intel hex is the payload that would
 * show up a provider mangling what it was given.
 *
 * The command itself is not run. It opens a save dialog nobody can answer in a
 * headless session, and a run that hangs there is worse than one check less.
 * That its id is registered at all is covered above.
 */
async function checkTheHexSurvivesBeingSaved(built: string): Promise<void> {
	const name = 'the hex is written back out as a real file';
	const root = benchRoot();
	if (!root) {
		record(name, false, 'no workspace folder to write into');
		return;
	}

	const target = vscode.Uri.joinPath(root, hexFilename('integration'));
	// The desktop bench is a real folder in this repository.
	if (await exists(target)) {
		record(name, false, `${target} is already there, and is not this check's to overwrite`);
		return;
	}

	try {
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(built));
		const read = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
		record(name, read === built && holdsBothBoards(read), `${target}, ${read.length} characters read back`);
	} catch (error) {
		record(name, false, String(error));
	} finally {
		await remove(target);
	}
}

/**
 * A universal hex opens each board's block with that board's id followed by
 * C0DE. Output carrying one of them is half the size and runs on half a
 * classroom, which is the failure worth naming rather than counting bytes.
 */
const holdsBothBoards = (hex: string) =>
	[microbitBoardId.V1, microbitBoardId.V2].every((id) => hex.includes(`${id.toString(16)}C0DE`));

/**
 * The project folder setting, against a real configuration service.
 *
 * The path rules are unit-tested; what only a host can show is that the setting
 * is read back at the scope it was written to, that the folder it names is
 * stat-ed on this host's scheme, and that a folder which is not there is a
 * refusal rather than an exception out of `prepareHex`. The bench already has
 * the shape: `lib/` holds one file the root does not.
 */
async function checkSelectionFollowsTheProjectFolder(): Promise<void> {
	const name = 'selection follows the project folder';
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		record(name, false, 'no workspace folder to configure');
		return;
	}

	// The bench's `.vscode/` is gitignored, so a developer's own launch
	// configuration can be sitting in it and is not this check's to delete.
	const dotVscode = vscode.Uri.joinPath(folder.uri, '.vscode');
	const settingsFile = vscode.Uri.joinPath(dotVscode, 'settings.json');
	const existedBefore = { folder: await exists(dotVscode), file: await exists(settingsFile) };

	const settings = vscode.workspace.getConfiguration(SECTION, folder.uri);
	// A developer mid-way through checking this feature by hand has one set.
	const before = settings.inspect(SETTINGS.projectFolder)?.workspaceFolderValue;
	try {
		await settings.update(SETTINGS.projectFolder, 'lib', vscode.ConfigurationTarget.WorkspaceFolder);
		const project = await resolveProject(folder);
		const names = project.ok ? (await selectWorkspaceFiles(project.uri)).files.map((file) => file.name) : [];
		record(name, project.ok && names.join(',') === 'helper.py', `lib/ selected [${names.join(', ')}]`);

		await settings.update(SETTINGS.projectFolder, 'nowhere', vscode.ConfigurationTarget.WorkspaceFolder);
		const missing = await resolveProject(folder);
		record(
			'a project folder that is not there is refused',
			!missing.ok && missing.problem === 'missing',
			missing.ok ? 'it resolved anyway' : `problem=${missing.problem}, named=${missing.named}`
		);

	} catch (error) {
		record(name, false, String(error));
	} finally {
		// Back to whatever was there, which is usually nothing.
		await settings
			.update(SETTINGS.projectFolder, before, vscode.ConfigurationTarget.WorkspaceFolder)
			.then(undefined, () => undefined);

		// Only what this check made. Neither delete is recursive, so a `.vscode`
		// that still holds something of somebody else's survives.
		if (!existedBefore.file) await remove(settingsFile);
		if (!existedBefore.folder) await remove(dotVscode);
	}
}

const exists = (uri: vscode.Uri) =>
	vscode.workspace.fs.stat(uri).then(
		() => true,
		() => false
	);

const remove = (uri: vscode.Uri) => vscode.workspace.fs.delete(uri).then(undefined, () => undefined);

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

	// Through `chooseWorkspaceFolder`, because it is what reads `workspaceFolders`
	// now and so it is what could go stale. One folder means it answers without
	// putting a quick pick in front of a headless run.
	const folder = await chooseWorkspaceFolder();
	if (!folder) {
		record('selection follows a swapped root', false, 'no root came back after the swap');
		return;
	}

	const selection = await selectWorkspaceFiles(folder.uri);
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
 * Which entry point ran. There are two, one per host, and the choice between
 * them is the editor's: an extension declaring both `main` and `browser` gets
 * `main` in a Node host and `browser` in a Web Worker one.
 *
 * Nothing else can see which arrived. A wrong answer means one host is running
 * code written for the other, and the first sign of it is a command failing at
 * a `navigator` or an `fs` that is not there.
 */
async function checkTheHostLoadedItsOwnEntry(extension: vscode.Extension<unknown>): Promise<void> {
	// `activate()` hands back the cached exports, so this costs nothing.
	const api = (await extension.activate()) as { entry?: unknown } | undefined;
	const expected = vscode.env.uiKind === vscode.UIKind.Desktop ? 'node' : 'browser';
	record(
		'the host loads the entry point written for it',
		api?.entry === expected,
		`uiKind=${expected === 'node' ? 'Desktop' : 'Web'}, entry=${JSON.stringify(api?.entry)}, expected ${expected}`
	);
}

/**
 * One VSIX carries both entry points, which is only true if both were built. A
 * missing one leaves that host loading nothing, with no error anywhere: the
 * extension is listed, activates, and contributes not one command.
 */
async function checkBothEntriesShip(extension: vscode.Extension<unknown>): Promise<void> {
	for (const field of ['browser', 'main']) {
		const declared: unknown = extension.packageJSON?.[field];
		if (typeof declared !== 'string') {
			record(`the manifest declares ${field}`, false, `${field}=${JSON.stringify(declared)}`);
			continue;
		}

		const target = vscode.Uri.joinPath(extension.extensionUri, ...declared.replace(/^\.\//, '').split('/'));
		record(`the ${field} entry is where the manifest says`, await exists(target), `${declared} -> ${target}`);
	}
}

/**
 * Where a desktop flash writes. The drive search hands back a mount point, a
 * bare drive letter on Windows and a path everywhere else, and joining a
 * filename onto it has to produce something the filesystem accepts. The drive
 * letter is the one that can surprise, and only a real host has `Uri` to try it.
 */
function checkAMountPointJoinsToAFile(): void {
	if (vscode.env.uiKind !== vscode.UIKind.Desktop) return;

	const windows = process.platform === 'win32';
	const mount = windows ? 'E:' : '/Volumes/MICROBIT';
	const joined = vscode.Uri.joinPath(vscode.Uri.file(mount), 'workspace.hex');
	const wanted = windows ? /^[A-Za-z]:\\workspace\.hex$/ : /^\/Volumes\/MICROBIT\/workspace\.hex$/;

	record('a mount point joins to a file path', wanted.test(joined.fsPath), `${mount} -> ${joined.fsPath}`);
}

/**
 * Where the extension runs, which having a `main` at all put in question: the
 * default for one is the **workspace**, so in a Remote-SSH, WSL, container or
 * Codespaces window it would run on the remote and go looking for a mounted
 * board on a machine the user has never plugged one into. `ui` keeps it beside
 * the hardware, and beside the serial companion it hands every terminal to,
 * which declares the same.
 *
 * Read back from the host rather than from the manifest, so this is the kind
 * that was actually resolved and not a second copy of what we asked for.
 */
function checkItRunsBesideTheHardware(extension: vscode.Extension<unknown>): void {
	record(
		'the extension runs on the machine the board is plugged into',
		extension.extensionKind === vscode.ExtensionKind.UI,
		`extensionKind=${vscode.ExtensionKind[extension.extensionKind] ?? extension.extensionKind}`
	);
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

/** A companion pass loads the real Eclipse extension; the base harness deliberately does not. */
async function checkSerialMonitorCompanion(): Promise<void> {
	const provider = vscode.extensions.getExtension(SERIAL_MONITOR_EXTENSION);
	const command = await waitForCommand('serial-monitor.openSerial');
	if (!provider && !command) {
		console.log('[test] SKIP  Eclipse Serial Monitor is not installed in this harness');
		return;
	}

	record(
		'Eclipse Serial Monitor contributes its command',
		command,
		command ? 'serial-monitor.openSerial is registered' : 'the extension is present but its command is absent'
	);
	if (vscode.env.uiKind === vscode.UIKind.Desktop || !provider) return;

	try {
		const exported = (await provider.activate()) as { getApi?(version: 2): Record<string, unknown> } | undefined;
		const api = exported?.getApi?.(2);
		const methods = ['openSerial', 'revealSerial', 'pauseSerial', 'resumeSerial', 'listPorts'];
		const missing = methods.filter((method) => typeof api?.[method] !== 'function');
		record(
			'Eclipse Serial Monitor exposes API v2 in the web host',
			missing.length === 0,
			missing.length ? `missing ${missing.join(', ')}` : 'all serial API methods are present'
		);
	} catch (error) {
		record('Eclipse Serial Monitor exposes API v2 in the web host', false, String(error));
	}
}

async function waitForCommand(command: string): Promise<boolean> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if ((await vscode.commands.getCommands(true)).includes(command)) return true;
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

/**
 * Reported, never asserted. WebUSB reaching the extension host is a property of
 * whichever workbench is hosting us, not of this extension, and the answer
 * decides whether the device work can be developed against this harness at all.
 * A failure here would say nothing about our code.
 */
async function reportWebUsb(): Promise<void> {
	const usb = webUsb();
	if (!usb) {
		record('WebUSB in the extension host', true, `navigator.usb is absent${hasNavigator() ? '' : ', with no navigator'}`);
		return;
	}

	try {
		const devices = await usb.getDevices();
		record('WebUSB in the extension host', true, `navigator.usb present, ${devices.length} already authorised`);
	} catch (error) {
		record('WebUSB in the extension host', true, `navigator.usb present, getDevices() threw: ${String(error)}`);
	}
}

/**
 * `navigator` is a browser global and the Node extension host has none, so
 * reading through it is a `ReferenceError` there rather than an absent WebUSB.
 * The `try` is for the other end of the same question: a privacy extension can
 * replace the property with a getter that throws.
 */
const hasNavigator = () => typeof navigator !== 'undefined';

function webUsb(): { getDevices(): Promise<unknown[]> } | undefined {
	try {
		return hasNavigator() ? (navigator as Navigator & { usb?: { getDevices(): Promise<unknown[]> } }).usb : undefined;
	} catch {
		return undefined;
	}
}

const REQUEST_USB_DEVICE = 'workbench.experimental.requestUsbDevice';

/**
 * Pairing goes through a command the workbench registers on the main thread,
 * because `requestDevice` is `Window`-only and the extension host is a worker.
 * Only the web workbench registers it: the desktop bundle carries the class
 * that would and never instantiates it. Reported rather than asserted, because
 * it is the host's property and the answer differs on purpose.
 */
async function reportTheUsbBridge(): Promise<boolean> {
	const registered = await vscode.commands.getCommands(true);
	const present = registered.includes(REQUEST_USB_DEVICE);
	record(
		'the workbench bridges requestDevice',
		true,
		present ? `${REQUEST_USB_DEVICE} is registered` : `${REQUEST_USB_DEVICE} is absent, so nothing can be paired here`
	);
	return present;
}

/**
 * The library falls through to a device chooser that does not exist in this
 * host, and the guard against it is a decision taken before the library is
 * asked. Run against the real `navigator.usb` and the real command list, since
 * what is being checked is what a host answers with nothing plugged in.
 *
 * Nothing here touches the extension's own connection: module state belongs to
 * the bundle it was loaded in, and this script is a second bundle, so its copy
 * of `src/usb/connection.ts` has none of the extension's.
 */
async function checkTheChooserIsNeverReached(bridged: boolean): Promise<void> {
	const name = 'no board means no connection attempt';
	let connected = false;
	let asked = false;
	const usb = webUsb();

	try {
		const outcome = await connectToBoard({
			authorised: async () => ((await usb?.getDevices()) ?? []) as UsbIdentity[],
			canPair: () => bridged,
			// Stubbed, and only here: the real bridge opens a chooser nothing in a
			// headless run can answer.
			pair: async () => {
				asked = true;
				return undefined;
			},
			connect: async () => {
				connected = true;
			},
			attached: () => undefined,
			log: () => undefined,
		});

		// A developer running this with a board already authorised in the profile
		// takes the other branch, and that is a pass as well: what must not happen
		// is connecting with nothing for the library to find.
		const expected = connected
			? outcome.done === 'connected' && !asked
			: outcome.done === 'unpairable' && asked === bridged;
		record(name, expected, `outcome=${outcome.done}, pairing asked=${asked}, connect called=${connected}`);
	} catch (error) {
		record(name, false, String(error));
	}
}

/**
 * Some privacy extensions replace `navigator.usb` with a getter that throws, and
 * the connection library reads that property unguarded in its availability check,
 * its `initialize()` and its `dispose()`. Every guard against it is ours.
 *
 * Only a real host can show this working: the reads are the library's, and it is
 * the extension's own live connection that has to survive them.
 *
 * **This covers the availability check and nothing else.** Activation is long over
 * by the time any test script loads, and disposal happens after this restores the
 * property, so the guards on those two are carried by inspection rather than by a
 * check. What is exercised is the command every WebUSB path goes through, which
 * has to refuse rather than throw.
 */
async function checkAHostileNavigatorIsSurvived(extension: vscode.Extension<unknown>): Promise<void> {
	const name = 'a navigator.usb that throws is refused, not fatal';
	// The Node host has no navigator at all, and nothing there reads WebUSB.
	if (!hasNavigator()) {
		console.log('[test] SKIP  this host has no navigator to make hostile');
		return;
	}

	const original = Object.getOwnPropertyDescriptor(navigator, 'usb');
	try {
		Object.defineProperty(navigator, 'usb', {
			configurable: true,
			get() {
				throw new Error('navigator.usb is blocked');
			},
		});
	} catch (error) {
		console.log(`[test] SKIP  navigator.usb cannot be replaced in this host: ${String(error)}`);
		return;
	}

	try {
		await vscode.commands.executeCommand(COMMANDS.connect);
		record(name, extension.isActive, `${COMMANDS.connect} returned, isActive=${extension.isActive}`);
	} catch (error) {
		record(name, false, `${COMMANDS.connect} threw: ${String(error)}`);
	} finally {
		// Deleting the shadow puts the prototype's own getter back in view.
		if (original) Object.defineProperty(navigator, 'usb', original);
		else Reflect.deleteProperty(navigator, 'usb');
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
