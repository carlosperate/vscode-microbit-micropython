import { microbitBoardId } from '@microbit/microbit-fs';
import type { BoardInfo, HexSource, MicrobitManagerApi } from 'vscode-bbcmicrobit-manager-api';
import * as vscode from 'vscode';

import type { ExtensionApi } from '../../src/activate';
import { flash } from '../../src/commands/flash';
import {
	CONTAINER_ID,
	EXTENSION_ID,
	MANAGER_API_VERSION,
	MANAGER_EXTENSION,
	PRODUCT,
	SECTION,
	SERIAL_MONITOR_EXTENSION,
	SETTINGS,
} from '../../src/config';
import { chooseWorkspaceFolder, resolveProject, selectWorkspaceFiles } from '../../src/files/workspace';
import { readFirmware } from '../../src/hex/assets';
import { buildFs, generateHex } from '../../src/hex/build';
import { checkManager } from '../../src/manager/api';
import { readSimulatorHtml } from '../../src/simulator/assets';
import { commandFor } from '../../src/simulator/controls';
import { SHELL_CONTROLS } from '../../src/simulator/protocol';
import { VIEW_ID } from '../../src/simulator/view';

/**
 * The integration tests: the same bundle run on two hosts, `@vscode/test-web` in
 * a browser and `@vscode/test-electron` on the desktop. It exists for the things
 * a stubbed `vscode` cannot see, above all whether the manifest and the code
 * agree about what this extension contributes, and whether the manager this
 * extension depends on serves the API it was built against.
 *
 * Every check reports before it asserts, so a failing run says which assumption
 * broke rather than stopping at the first one.
 */
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
	const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
	if (!extension) {
		throw new Error(
			`${EXTENSION_ID} is not loaded. --extensionTestsPath must point inside ` +
				'--extensionDevelopmentPath, or the script runs in a host this extension does not exist in.'
		);
	}

	const exported = await checkActivation(extension);
	checkTheHostLoadedItsOwnEntry(exported);
	await checkBothEntriesShip(extension);
	await checkTheSimulatorShips(extension);
	await checkTheSidebarIsItsOwn(extension);
	checkItRunsBesideTheHardware(extension);
	await checkContributedCommandsResolve(extension);
	checkEveryCommandSaysWhoOwnsIt(extension);
	await checkSerialMonitorCompanion();
	const manager = await checkTheManagerIsLinked(exported);
	await checkTheDocumentButtonsRunRealCommands(manager);
	await checkSelectionOnTheRealWorkspace();
	const built = await checkHexBuildsFromTheRealWorkspace(extension);
	if (built) await checkTheHexSurvivesBeingSaved(built);
	if (manager) await checkAFlashHandsTheManagerWhatItBuilt(extension, manager);
	await checkSelectionFollowsTheProjectFolder();

	// Last, and never in the middle. Replacing workspace folder 0 may terminate
	// and restart every running extension, this script included, so anything after
	// it can be cut off with no summary printed. On a slow runner that reads as a
	// suite that vanished rather than one that failed.
	await checkSelectionFollowsTheRoot();

	summarise();
}

/**
 * An activation that throws leaves the extension registered but inert, and says
 * nothing in the UI, so this is the check that turns "the extension does
 * nothing" into a named failure. A failure that already happened at startup is
 * replayed here, because `activate()` hands back the cached result.
 */
async function checkActivation(extension: vscode.Extension<ExtensionApi>): Promise<ExtensionApi | undefined> {
	try {
		const exported = await extension.activate();
		record('activation completes', extension.isActive, `isActive=${extension.isActive}`);
		return exported;
	} catch (error) {
		record('activation completes', false, `activate() threw: ${String(error)}`);
		return undefined;
	}
}

/**
 * Which entry point ran. There are two, one per host, and the choice between
 * them is the editor's: an extension declaring both `main` and `browser` gets
 * `main` in a Node host and `browser` in a Web Worker one. Nothing else can see
 * which arrived.
 */
function checkTheHostLoadedItsOwnEntry(exported: ExtensionApi | undefined): void {
	const expected = vscode.env.uiKind === vscode.UIKind.Desktop ? 'node' : 'browser';
	record(
		'the host loads the entry point written for it',
		exported?.entry === expected,
		`uiKind=${expected === 'node' ? 'Desktop' : 'Web'}, entry=${JSON.stringify(exported?.entry)}, expected ${expected}`
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
 * The simulator is a folder read at runtime and a view the manifest contributes,
 * so a packaging mistake shows up here rather than as a blank view on someone's
 * machine. Booting the WebAssembly is timing-dependent, so the document itself is
 * not built here; the driven checks cover that.
 */
async function checkTheSimulatorShips(extension: vscode.Extension<unknown>): Promise<void> {
	try {
		const html = await readSimulatorHtml(extension.extensionUri);
		record('the simulator assets are readable', html.includes('build/firmware.js'), `${html.length} characters`);
	} catch (error) {
		record('the simulator assets are readable', false, `from ${extension.extensionUri}: ${String(error)}`);
	}

	// Read rather than stat: on web the stat answers for any URI, present or not.
	const shell = vscode.Uri.joinPath(extension.extensionUri, 'dist', 'webview', 'simulator.js');
	try {
		const bytes = await vscode.workspace.fs.readFile(shell);
		record('the webview shell is where the document expects it', bytes.length > 0, `${shell}, ${bytes.length} bytes`);
	} catch (error) {
		record('the webview shell is where the document expects it', false, `${shell}: ${String(error)}`);
	}
}

/**
 * The simulator's view in this extension's own container, with no `when`. A
 * container id that does not resolve sends the view to the Explorer with nothing
 * but a log line, and the workbench registers a `.focus` command per view and
 * container only once it has accepted them, so this asks it rather than the JSON.
 */
async function checkTheSidebarIsItsOwn(extension: vscode.Extension<unknown>): Promise<void> {
	const containers: { id?: string; title?: string }[] = extension.packageJSON?.contributes?.viewsContainers?.activitybar ?? [];
	const views: { id?: string; type?: string; when?: string }[] =
		extension.packageJSON?.contributes?.views?.[CONTAINER_ID] ?? [];
	record(
		'the simulator is the one view in a container of our own',
		containers.length === 1 &&
			containers[0]?.title === PRODUCT &&
			views.length === 1 &&
			views[0]?.id === VIEW_ID &&
			views[0]?.type === 'webview' &&
			views[0]?.when === undefined,
		`${containers.map((entry) => `${entry.id} "${entry.title}"`).join(', ') || 'no container'} holds ` +
			`${views.map((view) => `${view.id} when ${view.when ?? 'always'}`).join(', ') || 'nothing'}`
	);

	const registered = await vscode.commands.getCommands(true);
	const expected = [`workbench.view.extension.${CONTAINER_ID}`, `${VIEW_ID}.focus`];
	const missing = expected.filter((command) => !registered.includes(command));
	record(
		'the workbench registered the container and the view',
		missing.length === 0,
		missing.length ? `missing: ${missing.join(', ')}` : expected.join(', ')
	);
}

/**
 * Where the extension runs, which having a `main` at all put in question: the
 * default for one is the **workspace**, so in a Remote-SSH, WSL, container or
 * Codespaces window it would run on the remote and go looking for a mounted
 * board on a machine the user has never plugged one into. `ui` keeps it beside
 * the hardware, and beside the manager and serial companion, which declare the
 * same.
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
 * running it reveals there is no handler.
 */
async function checkContributedCommandsResolve(extension: vscode.Extension<unknown>): Promise<void> {
	const contributed: string[] = (extension.packageJSON?.contributes?.commands ?? []).map(
		(command: { command: string }) => command.command
	);

	if (contributed.length === 0) {
		record('contributed commands resolve', false, 'the manifest contributes no commands at all');
		return;
	}

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
 * A command with no category reads in the palette as a bare "Flash", beside the
 * Foundation's own entries, with nothing saying which extension owns it.
 */
function checkEveryCommandSaysWhoOwnsIt(extension: vscode.Extension<unknown>): void {
	const contributed: { command: string; category?: string }[] = extension.packageJSON?.contributes?.commands ?? [];
	const wrong = contributed.filter((entry) => entry.category !== PRODUCT);
	record(
		'every contributed command is filed under the product name',
		contributed.length > 0 && wrong.length === 0,
		wrong.length
			? wrong.map((entry) => `${entry.command} is ${JSON.stringify(entry.category)}`).join(', ')
			: `all ${contributed.length} carry "${PRODUCT}"`
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
 * The seam the split created, and the only place it can be seen: the manager is
 * loaded, it serves the API this extension was built against, and it took this
 * extension's menu group. Its absence is a harness fault and is reported as one.
 */
async function checkTheManagerIsLinked(exported: ExtensionApi | undefined): Promise<MicrobitManagerApi | undefined> {
	const manager = vscode.extensions.getExtension(MANAGER_EXTENSION);
	if (!manager) {
		record(
			'the manager extension is loaded beside this one',
			false,
			`${MANAGER_EXTENSION} is not loaded. The harness unpacks it into .vscode-test/manager and passes that folder to both hosts.`
		);
		return undefined;
	}

	let api: unknown;
	try {
		api = await manager.activate();
	} catch (error) {
		record('the manager extension activates', false, `activate() threw: ${String(error)}`);
		return undefined;
	}
	const check = checkManager(api, MANAGER_API_VERSION);
	record(
		'the manager serves the API this extension was built against',
		check.kind === 'accepted',
		`${check.kind}, this needs ${MANAGER_API_VERSION}${check.kind === 'accepted' ? '' : `, problem: ${String(exported?.manager.problem)}`}`
	);
	if (check.kind !== 'accepted') return undefined;

	record(
		'the manager took the menu group',
		exported?.manager.registered === true,
		`registered=${String(exported?.manager.registered)}, API ${check.api.version}`
	);
	return check.api;
}

/**
 * The document's buttons post a control the view turns into a command, ours or
 * the manager's, so a wrong id is a button that logs and does nothing. Only a
 * real host knows which commands exist, so the mapping is checked against it here.
 */
async function checkTheDocumentButtonsRunRealCommands(manager: MicrobitManagerApi | undefined): Promise<void> {
	const registered = await vscode.commands.getCommands(true);
	const mapped = SHELL_CONTROLS.map((control) => ({
		control,
		command: commandFor(control, () => manager?.commands.openTerminal),
	})).filter((entry): entry is { control: (typeof SHELL_CONTROLS)[number]; command: string } => !!entry.command);
	const unknown = mapped.filter((entry) => !registered.includes(entry.command));
	record(
		"the document's buttons run commands the host registered",
		mapped.length === 3 && unknown.length === 0,
		`${mapped.map((entry) => `${entry.control} runs ${entry.command}`).join('; ')}${
			unknown.length ? `; unknown: ${unknown.map((entry) => entry.command).join(', ')}` : ''
		}`
	);
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
 * Reading a file that ships inside the extension is the one thing that differs
 * most between the two hosts: `extensionUri` is a real `file:` URI on the
 * desktop, which `fetch` refuses outright, and an http URL in a browser, which
 * answers a missing file with an error page and a 200 rather than a failure.
 *
 * The build that follows is the heaviest thing this extension does, a megabyte
 * of Intel hex parsed and reassembled, and it happens inside a Web Worker on
 * both hosts. Unit tests run it in Node, where a great deal more is available.
 */
async function checkHexBuildsFromTheRealWorkspace(extension: vscode.Extension<unknown>): Promise<string | undefined> {
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
 * workspace: virtual in the browser, real `file:` URIs on the desktop. The
 * command itself is not run: it ends in the manager's save dialog, which nobody
 * can answer in a headless session.
 */
async function checkTheHexSurvivesBeingSaved(built: string): Promise<void> {
	const name = 'the hex is written back out as a real file';
	const root = benchRoot();
	if (!root) {
		record(name, false, 'no workspace folder to write into');
		return;
	}

	const target = vscode.Uri.joinPath(root, 'integration.hex');
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
 * The cross-extension seam, from this side: Flash asks the manager which board,
 * builds for that board and no other, and hands the hex back with the same board
 * as `expect`. The manager's half is stubbed, since the real `connect()` ends at
 * a device chooser on web and a drive search on desktop, neither of which a
 * headless run can answer; what is proved is that the bytes and the board that
 * reach `flashHex` are the ones the contract promises.
 */
async function checkAFlashHandsTheManagerWhatItBuilt(
	extension: vscode.Extension<unknown>,
	manager: MicrobitManagerApi
): Promise<void> {
	const name = 'Flash builds for the board the manager answered and hands it back as expect';
	const board: BoardInfo = { version: 'V2', serialNumber: 'integration-test' };
	let connects = 0;
	let received: { hex: HexSource; expect: BoardInfo | undefined } | undefined;
	const stub: MicrobitManagerApi = {
		...manager,
		connect: () => {
			connects += 1;
			return Promise.resolve(board);
		},
		flashHex: (hex, options) => {
			received = { hex, expect: options?.expect };
			return Promise.resolve(true);
		},
	};

	// Only what `prepareHex` reads: the firmware's location and the omission memory.
	const context = {
		extensionUri: extension.extensionUri,
		workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
	} as unknown as vscode.ExtensionContext;

	try {
		await flash({ api: () => stub, status: { registered: true, problem: undefined } })(context);
	} catch (error) {
		record(name, false, `Flash threw: ${String(error)}`);
		return;
	}

	const hex = typeof received?.hex === 'string' ? received.hex : undefined;
	record(
		name,
		connects === 1 && hex !== undefined && hex.startsWith(':') && !holdsBothBoards(hex) && received?.expect === board,
		`connect() called ${connects} time(s), flashHex got ${hex ? `${hex.length} characters of a ${holdsBothBoards(hex) ? 'universal' : 'single-board'} hex` : 'nothing'}, expect ${received?.expect === board ? 'is the board connect() answered' : JSON.stringify(received?.expect)}`
	);
}

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
